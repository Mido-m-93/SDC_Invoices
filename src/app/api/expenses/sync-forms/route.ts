// POST /api/expenses/sync-forms
// Fetches the RC経費精算 Microsoft Forms Excel from OneDrive and syncs
// expense claims into Supabase. Uses a stable ID derived from each row's
// submission fingerprint so re-syncing the same data is idempotent.
//
// Required env vars:
//   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
//   MICROSOFT_OWNER_UPN          (e.g. admin@example.com)
//   MICROSOFT_EXPENSE_EXCEL_ITEM_ID  (OneDrive drive item ID of the Forms Excel)

import { NextResponse } from "next/server";
import { read, utils } from "xlsx";
import type { ExpenseClaim, ExpenseCategory } from "@/types";
import { getExpenseService } from "@/lib/services";

export const dynamic = "force-dynamic";

// ── Stable ID ─────────────────────────────────────────────────────────────────
// Deterministic ID from submission fingerprint — prevents duplicates on re-sync.
function stableId(submittedAt: string, submittedBy: string, amount: string): string {
  const key = `${submittedAt}|${submittedBy}|${amount}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  }
  return `exp_sync_${Math.abs(h).toString(36).padStart(8, "0")}`;
}

// ── Column keyword mapping (same as upload route) ─────────────────────────────
type ExpenseField =
  | "submittedAt" | "submittedBy" | "submittedByEmail"
  | "amount" | "expenseDate" | "receiptUrl"
  | "description" | "bankAccount";

const KEYWORD_RULES: Array<{ keywords: string[]; field: ExpenseField }> = [
  { keywords: ["Start time", "開始時刻"],           field: "submittedAt" },
  { keywords: ["Email"],                            field: "submittedByEmail" },
  { keywords: ["金額", "Amount"],                   field: "amount" },
  { keywords: ["日付", "Date"],                     field: "expenseDate" },
  { keywords: ["領収書", "Receipt"],                 field: "receiptUrl" },
  { keywords: ["備考", "Notes", "Route"],            field: "description" },
  { keywords: ["銀行口座", "Bank Account", "振込先"], field: "bankAccount" },
  { keywords: ["お名前", "名前", "氏名", "Name"],   field: "submittedBy" },
];

function buildFieldMap(headers: string[]): Map<string, ExpenseField> {
  const map     = new Map<string, ExpenseField>();
  const bestLen = new Map<ExpenseField, number>();
  for (const header of headers) {
    const lower = header.toLowerCase();
    for (const rule of KEYWORD_RULES) {
      if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
        const prev = bestLen.get(rule.field) ?? 0;
        if (header.length > prev) {
          for (const [h, f] of Array.from(map.entries())) {
            if (f === rule.field) { map.delete(h); break; }
          }
          map.set(header, rule.field);
          bestLen.set(rule.field, header.length);
        }
        break;
      }
    }
  }
  return map;
}

// ── Value converters (same as upload route) ───────────────────────────────────
function serialToISO(value: string): string {
  const num = Number(value);
  if (!isNaN(num) && num > 40000)
    return new Date((num - 25569) * 86400_000 - 9 * 3_600_000).toISOString();
  if (/^\d{4}/.test(value)) return new Date(value.replace(/\//g, "-")).toISOString();
  return new Date().toISOString();
}

function serialToDate(value: string): string {
  const num = Number(value);
  if (!isNaN(num) && num > 40000) {
    const d = new Date(Math.round((num - 25569) * 86400_000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const mdy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  if (/^\d{4}[\/\-]/.test(value)) return value.replace(/\//g, "-").slice(0, 10);
  return value;
}

function parseAmount(value: string): number {
  const num = parseFloat(value.replace(/[^0-9.]/g, ""));
  return isNaN(num) ? 0 : num;
}

function inferCategory(description: string): ExpenseCategory {
  const v = description;
  if (/[→↔]|から.{0,10}まで|via|電車|バス|タクシー|subway|train|taxi|bus|station|駅/.test(v)) return "transport";
  if (/hotel|宿泊|ホテル|accommodation/.test(v))   return "accommodation";
  if (/lunch|dinner|breakfast|食事|飲食|外食|ランチ|ディナー|meal/.test(v)) return "meals";
  if (/software|ソフト|app|subscription|サブスク/.test(v)) return "software";
  if (/研修|training|seminar|セミナー|workshop/.test(v)) return "training";
  if (/接待|交際|entertainment/.test(v)) return "entertainment";
  if (/備品|文具|事務用品|office supply|stationery|コピー用紙|インク|トナー|ボールペン|付箋|マーカー/.test(v)) return "office_supplies";
  return "other";
}

// ── Row mapper ────────────────────────────────────────────────────────────────
function mapRow(
  row: Record<string, unknown>,
  fieldMap: Map<string, ExpenseField>,
  rowIndex: number,
): ExpenseClaim | null {
  const get = (f: ExpenseField): string => {
    for (const [header, field] of Array.from(fieldMap.entries())) {
      if (field === f) return String(row[header] ?? "").trim();
    }
    return "";
  };

  const submittedBy = get("submittedBy");
  if (!submittedBy) return null;

  const description  = get("description");
  const receiptRaw   = get("receiptUrl");
  const rawAt        = get("submittedAt");
  const rawAmount    = get("amount");
  const now          = new Date().toISOString();
  const submittedAt  = serialToISO(rawAt) || now;

  const category             = inferCategory(description);
  const isNoReceiptTransport = category === "transport" && /[→↔]|電車|バス|train|bus|subway|公共交通|metro|路線/i.test(description);
  const violations: string[] = [];
  if (!receiptRaw && !isNoReceiptTransport) violations.push("MISSING_RECEIPT");

  return {
    id:                 stableId(submittedAt, submittedBy, rawAmount),
    submittedBy,
    submittedByEmail:   get("submittedByEmail"),
    submittedAt,
    category,
    description,
    amount:             parseAmount(rawAmount),
    currency:           "JPY",
    paymentMethod:      "personal_reimbursement",
    receiptUrl:         receiptRaw,
    receiptFilename:    receiptRaw ? `receipt_row${rowIndex + 2}` : "",
    projectName:        "",
    internalDepartment: "",
    expenseDate:        serialToDate(get("expenseDate")),
    status:             "submitted",
    reviewerComment:    "",
    reviewedBy:         "",
    reviewedAt:         null,
    approvedBy:         "",
    approvedAt:         null,
    paidAt:             null,
    extractedAmount:    null,
    extractedDate:      null,
    extractedVendor:    null,
    policyViolations:   violations,
    bankAccount:        get("bankAccount"),
    createdAt:          now,
    updatedAt:          now,
  };
}

// ── Microsoft Graph helpers ───────────────────────────────────────────────────
async function getGraphToken(): Promise<string> {
  const tenantId     = process.env.AZURE_TENANT_ID!;
  const clientId     = process.env.AZURE_CLIENT_ID!;
  const clientSecret = process.env.AZURE_CLIENT_SECRET!;

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     clientId,
        client_secret: clientSecret,
        scope:         "https://graph.microsoft.com/.default",
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph token request failed ${res.status}: ${body}`);
  }
  const { access_token } = await res.json() as { access_token: string };
  return access_token;
}

async function fetchExcelFromOneDrive(): Promise<Buffer> {
  const ownerUpn = process.env.MICROSOFT_OWNER_UPN!;
  const itemId   = process.env.MICROSOFT_EXPENSE_EXCEL_ITEM_ID!;
  const token    = await getGraphToken();

  // Resolve the user's personal OneDrive drive ID
  const driveRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(ownerUpn)}/drive`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!driveRes.ok) {
    const body = await driveRes.text().catch(() => "");
    throw new Error(`OneDrive drive lookup failed ${driveRes.status}: ${body}`);
  }
  const { id: driveId } = await driveRes.json() as { id: string };

  // Download the Excel file content
  const fileRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!fileRes.ok) {
    const body = await fileRes.text().catch(() => "");
    throw new Error(`Excel file download failed ${fileRes.status}: ${body}`);
  }
  return Buffer.from(await fileRes.arrayBuffer());
}

// ── GET: list OneDrive files to find the correct item ID ─────────────────────
export async function GET() {
  const missing = (["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "MICROSOFT_OWNER_UPN"] as const)
    .filter((k) => !process.env[k]);
  if (missing.length > 0)
    return NextResponse.json({ error: `Missing: ${missing.join(", ")}` }, { status: 500 });

  try {
    const ownerUpn = process.env.MICROSOFT_OWNER_UPN!;
    const token    = await getGraphToken();

    const driveRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(ownerUpn)}/drive`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { id: driveId } = await driveRes.json() as { id: string };

    // List Excel files in the drive root and Forms folder
    const listRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/root/search(q='.xlsx')?$select=id,name,lastModifiedDateTime,size&$top=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { value: files } = await listRes.json() as { value: Array<{ id: string; name: string; lastModifiedDateTime: string; size: number }> };

    return NextResponse.json({
      hint: "Copy the 'id' of your Forms Excel file and set it as MICROSOFT_EXPENSE_EXCEL_ITEM_ID in Vercel",
      files: files.map((f) => ({ id: f.id, name: f.name, lastModified: f.lastModifiedDateTime, sizeKB: Math.round(f.size / 1024) })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST: sync claims from OneDrive Excel ─────────────────────────────────────
export async function POST() {
  // Validate required env vars before making any network calls
  const missing = (["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "MICROSOFT_OWNER_UPN", "MICROSOFT_EXPENSE_EXCEL_ITEM_ID"] as const)
    .filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing environment variables: ${missing.join(", ")}` },
      { status: 500 }
    );
  }

  try {
    const buffer    = await fetchExcelFromOneDrive();
    const workbook  = read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName)
      return NextResponse.json({ error: "No sheets found in workbook" }, { status: 400 });

    const rows    = utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: "" });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const fieldMap = buildFieldMap(headers);

    console.log("[expenses/sync-forms] headers:", JSON.stringify(headers));

    const claims: ExpenseClaim[] = rows
      .map((row, i) => mapRow(row, fieldMap, i))
      .filter((c): c is ExpenseClaim => c !== null);

    if (claims.length === 0) {
      return NextResponse.json(
        { error: "0 rows matched — column headers not recognised.", detectedHeaders: headers },
        { status: 422 }
      );
    }

    const svc = getExpenseService();
    await Promise.all(claims.map((c) => svc.saveClaim(c)));

    console.log(`[expenses/sync-forms] Synced ${claims.length} claims from OneDrive`);
    return NextResponse.json({ count: claims.length, synced: claims.length });
  } catch (err) {
    console.error("[POST /api/expenses/sync-forms]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
