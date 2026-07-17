// POST /api/expenses/sync-forms
// Downloads the Microsoft Forms expense response Excel from OneDrive via
// Microsoft Graph API and imports new claims. Re-syncing is safe — deduplicates
// by submittedAt|submittedBy|amount so rows already imported are skipped.

import "server-only";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { generateId } from "@/lib/utils";
import type { ExpenseClaim, ExpenseCategory } from "@/types";
import { getExpenseService } from "@/lib/services";

export const dynamic = "force-dynamic";

const TENANT_ID     = process.env.AZURE_TENANT_ID!;
const CLIENT_ID     = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;
const OWNER_UPN     = process.env.MICROSOFT_OWNER_UPN!;
const ITEM_ID       = process.env.MICROSOFT_EXPENSE_EXCEL_ITEM_ID!;

// ── Graph auth ────────────────────────────────────────────────────────────────
async function getAccessToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type:    "client_credentials",
        scope:         "https://graph.microsoft.com/.default",
      }),
    }
  );
  const data = await res.json() as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`Token request failed: ${data.error} — ${data.error_description}`);
  }
  return data.access_token;
}

// ── Column keyword mapping ────────────────────────────────────────────────────
type ExpenseField =
  | "submittedAt" | "submittedBy" | "submittedByEmail"
  | "amount" | "expenseDate" | "receiptUrl"
  | "description" | "bankAccount";

const KEYWORD_RULES: Array<{ keywords: string[]; field: ExpenseField }> = [
  { keywords: ["Start time", "開始時刻", "Timestamp", "timestamp"],    field: "submittedAt" },
  { keywords: ["Email", "email", "メールアドレス"],                    field: "submittedByEmail" },
  { keywords: ["金額", "Amount"],                                      field: "amount" },
  { keywords: ["日付", "Date", "支払日", "経費日"],                    field: "expenseDate" },
  { keywords: ["領収書", "Receipt"],                                    field: "receiptUrl" },
  { keywords: ["備考", "Notes", "Route", "経路", "内容", "説明"],      field: "description" },
  { keywords: ["銀行口座", "Bank Account", "振込先"],                   field: "bankAccount" },
  { keywords: ["お名前", "名前", "氏名", "Name"],                      field: "submittedBy" },
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

function inferCategory(description: string): ExpenseCategory {
  const v = description;
  if (/[→↔]|から.{0,10}まで|via|電車|バス|タクシー|subway|train|taxi|bus|station|駅/.test(v)) return "transport";
  if (/hotel|宿泊|ホテル|accommodation/.test(v))   return "accommodation";
  if (/lunch|dinner|breakfast|食事|飲食|外食|ランチ|ディナー|meal/.test(v)) return "meals";
  if (/software|ソフト|app|subscription|サブスク/.test(v)) return "software";
  if (/研修|training|seminar|セミナー|workshop/.test(v)) return "training";
  if (/接待|交際|entertainment/.test(v)) return "entertainment";
  if (/備品|文具|事務用品|office supply|stationery|コピー用紙|インク|トナー/.test(v)) return "office_supplies";
  return "other";
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST() {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    return NextResponse.json({ error: "Microsoft Graph credentials not configured." }, { status: 503 });
  }
  if (!ITEM_ID) {
    return NextResponse.json({ error: "MICROSOFT_EXPENSE_EXCEL_ITEM_ID not set." }, { status: 503 });
  }
  if (!OWNER_UPN) {
    return NextResponse.json({ error: "MICROSOFT_OWNER_UPN not set." }, { status: 503 });
  }

  try {
    const token = await getAccessToken();

    // Get the owner's personal OneDrive ID
    const driveInfo = await fetch(
      `https://graph.microsoft.com/v1.0/users/${OWNER_UPN}/drive`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    if (!driveInfo.ok) {
      const body = await driveInfo.text();
      throw new Error(`Failed to resolve drive for ${OWNER_UPN} (${driveInfo.status}): ${body}`);
    }
    const { id: driveId } = await driveInfo.json() as { id: string };

    // Download the Excel file directly (bypasses Graph caching)
    const fileRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${ITEM_ID}/content`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    if (!fileRes.ok) {
      const body = await fileRes.text();
      throw new Error(`Failed to download expense Excel (${fileRes.status}): ${body}`);
    }

    const buffer   = await fileRes.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: "",
      raw: false,
    });

    console.log("[expenses/sync-forms] sheet:", workbook.SheetNames[0], "rows:", rows.length);

    if (rows.length === 0) {
      return NextResponse.json({ imported: 0, skipped: 0, message: "No responses yet." });
    }

    const headers  = Object.keys(rows[0]);
    const fieldMap = buildFieldMap(headers);
    console.log("[expenses/sync-forms] headers:", headers);
    console.log("[expenses/sync-forms] fieldMap:", JSON.stringify(Object.fromEntries(fieldMap)));

    // Find the receipt column index so we can read the cell's hyperlink (.l.Target),
    // which contains the actual uploaded-file URL — the plain cell value often holds
    // the Excel viewer URL instead of the receipt PDF.
    const receiptHeader = [...fieldMap.entries()].find(([, f]) => f === "receiptUrl")?.[0];
    const receiptColIdx = receiptHeader !== undefined ? headers.indexOf(receiptHeader) : -1;

    const get = (row: Record<string, string>, field: ExpenseField): string => {
      for (const [header, f] of Array.from(fieldMap.entries())) {
        if (f === field) return (row[header] ?? "").toString().trim();
      }
      return "";
    };

    const now = new Date().toISOString();
    // Use flatMap with rawIdx so we track the original sheet row index (header is row 0,
    // first data row is row 1, etc.) — needed for hyperlink extraction.
    const claims: ExpenseClaim[] = rows
      .flatMap((row, rawIdx): ExpenseClaim[] => {
        if (!Object.values(row).some((v) => v !== "")) return [];
        const submittedBy = get(row, "submittedBy");
        if (!submittedBy) return [];

        const description = get(row, "description");

        // Try to get the hyperlink URL from the receipt column cell.
        // rawIdx + 1 because sheet row 0 is the header row.
        let receiptRaw = get(row, "receiptUrl");
        if (receiptColIdx >= 0) {
          const cellRef = XLSX.utils.encode_cell({ r: rawIdx + 1, c: receiptColIdx });
          const hyperlinkTarget = (sheet[cellRef]?.l?.Target as string | undefined) ?? null;
          if (hyperlinkTarget) {
            console.log(`[expenses/sync-forms] row ${rawIdx + 1} receipt hyperlink:`, hyperlinkTarget);
            receiptRaw = hyperlinkTarget;
          } else {
            console.log(`[expenses/sync-forms] row ${rawIdx + 1} receipt cell value (no hyperlink):`, receiptRaw);
          }
        }
        const category    = inferCategory(description);
        const isNoReceiptTransport =
          category === "transport" && /[→↔]|電車|バス|train|bus|subway|公共交通|metro|路線/i.test(description);
        const violations: string[] = [];
        if (!receiptRaw && !isNoReceiptTransport) violations.push("MISSING_RECEIPT");

        const rawTs       = get(row, "submittedAt");
        const submittedAt = rawTs ? new Date(rawTs).toISOString() : now;
        const amountRaw   = get(row, "amount");
        const amount      = parseFloat(amountRaw.replace(/[^0-9.]/g, "")) || 0;

        const claim: ExpenseClaim = {
          id:                 generateId("exp"),
          submittedBy,
          submittedByEmail:   get(row, "submittedByEmail"),
          submittedAt,
          category,
          description,
          amount,
          currency:           "JPY",
          paymentMethod:      "personal_reimbursement",
          receiptUrl:         receiptRaw,
          receiptFilename:    receiptRaw ? `receipt_${submittedBy}` : "",
          projectName:        "",
          internalDepartment: "",
          expenseDate:        get(row, "expenseDate"),
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
          bankAccount:        get(row, "bankAccount"),
          createdAt:          now,
          updatedAt:          now,
        };
        return [claim];
      });

    // Deduplicate: skip rows already saved (same submittedAt + submittedBy + amount)
    const svc      = getExpenseService();
    const existing = await svc.listClaims();
    const seen     = new Set(
      existing.map((c) => `${c.submittedAt}|${c.submittedBy}|${c.amount}`)
    );

    const fresh = claims.filter(
      (c) => !seen.has(`${c.submittedAt}|${c.submittedBy}|${c.amount}`)
    );

    await Promise.all(fresh.map((c) => svc.saveClaim(c)));

    console.log(`[expenses/sync-forms] ${fresh.length} imported, ${claims.length - fresh.length} skipped`);
    return NextResponse.json({ imported: fresh.length, skipped: claims.length - fresh.length, total: claims.length });
  } catch (err) {
    console.error("[POST /api/expenses/sync-forms]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
