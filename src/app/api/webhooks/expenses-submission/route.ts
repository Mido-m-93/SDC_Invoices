// POST /api/webhooks/expenses-submission
// Power Automate calls this the moment a new RC経費精算 Forms response is
// submitted — bypasses the Forms→Excel sync lag entirely.
import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import type { ExpenseClaim, ExpenseCategory } from "@/types";

export const dynamic = "force-dynamic";

// ── Field mapping (mirrors sync-forms logic) ──────────────────────────────────
type ExpenseField =
  | "submittedAt" | "submittedBy" | "submittedByEmail"
  | "amount" | "expenseDate" | "receiptUrl"
  | "description" | "bankAccount";

const KEYWORD_RULES: Array<{ keywords: string[]; field: ExpenseField }> = [
  { keywords: ["Start time", "開始時刻"],                                                           field: "submittedAt" },
  { keywords: ["Email"],                                                                            field: "submittedByEmail" },
  { keywords: ["金額", "Amount", "費用", "請求金額", "経費金額", "経費額", "合計"],                 field: "amount" },
  { keywords: ["日付", "Date", "支出日", "購入日", "経費発生日"],                                    field: "expenseDate" },
  { keywords: ["領収書", "Receipt", "添付", "ファイル", "upload", "attachment", "file", "請求書"], field: "receiptUrl" },
  { keywords: ["備考", "Notes", "Route", "目的", "用途", "内容", "支出内容", "経費内容", "経費の目的", "使途", "詳細", "Detail", "reason", "purpose", "description", "memo", "メモ", "コメント"], field: "description" },
  { keywords: ["銀行口座", "Bank Account", "振込先", "口座", "bank"],                              field: "bankAccount" },
  { keywords: ["お名前", "名前", "氏名", "Name", "氏名・名前"],                                    field: "submittedBy" },
];

function buildFieldMap(headers: string[]): Map<string, ExpenseField> {
  const map = new Map<string, ExpenseField>();
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

function inferCategory(desc: string): ExpenseCategory {
  if (/[→↔]|から.{0,10}まで|via|電車|バス|タクシー|subway|train|taxi|bus|station|駅/.test(desc)) return "transport";
  if (/hotel|宿泊|ホテル|accommodation/.test(desc)) return "accommodation";
  if (/lunch|dinner|breakfast|食事|飲食|外食|ランチ|ディナー|meal/.test(desc)) return "meals";
  if (/software|ソフト|app|subscription|サブスク/.test(desc)) return "software";
  if (/研修|training|seminar|セミナー|workshop/.test(desc)) return "training";
  if (/接待|交際|entertainment/.test(desc)) return "entertainment";
  if (/備品|文具|事務用品|office supply|stationery/.test(desc)) return "office_supplies";
  return "other";
}

function stableId(submittedAt: string, submittedBy: string, amount: string): string {
  const key = `${submittedAt}|${submittedBy}|${amount}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return `exp_sync_${Math.abs(h).toString(36).padStart(8, "0")}`;
}

function parseAmount(v: string): number {
  const n = parseFloat(v.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

function extractFilename(url: string): string {
  if (!url) return "";
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    return last || (url.split("/").pop()?.split("?")[0] ?? "receipt");
  } catch {
    return url.split("/").pop()?.split("?")[0] ?? "receipt";
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const secret = process.env.FORMS_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "FORMS_WEBHOOK_SECRET not configured" }, { status: 500 });
  if (req.headers.get("x-webhook-secret") !== secret)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { fields?: Record<string, string>; submittedAt?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.fields || typeof body.fields !== "object")
    return NextResponse.json({ error: "Provide 'fields': a map of Form question title -> answer text" }, { status: 400 });

  const headers = Object.keys(body.fields);
  const fieldMap = buildFieldMap(headers);
  const get = (f: ExpenseField): string => {
    for (const [header, field] of Array.from(fieldMap)) {
      if (field === f) return (body.fields![header] ?? "").toString().trim();
    }
    return "";
  };

  const submittedBy = get("submittedBy");
  if (!submittedBy)
    return NextResponse.json({ error: "Could not find a Name field", receivedKeys: headers }, { status: 400 });

  const now         = new Date().toISOString();
  const submittedAt = body.submittedAt ?? get("submittedAt") ?? now;
  const rawAmount   = get("amount");
  const description = get("description");
  const receiptUrl  = get("receiptUrl");
  const category    = inferCategory(description);
  const isNoReceiptTransport = category === "transport" && /[→↔]|電車|バス|train|bus|subway|公共交通|metro|路線/i.test(description);
  const policyViolations: string[] = (!receiptUrl && !isNoReceiptTransport) ? ["MISSING_RECEIPT"] : [];

  const claim: ExpenseClaim = {
    id:                 stableId(submittedAt, submittedBy, rawAmount),
    submittedBy,
    submittedByEmail:   get("submittedByEmail"),
    submittedAt,
    category,
    description,
    amount:             parseAmount(rawAmount),
    currency:           "JPY",
    paymentMethod:      "personal_reimbursement",
    receiptUrl,
    receiptFilename:    extractFilename(receiptUrl),
    projectName:        "",
    internalDepartment: "",
    expenseDate:        get("expenseDate") || now.slice(0, 10),
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
    extractedPurpose:   null,
    policyViolations,
    bankAccount:        get("bankAccount"),
    createdAt:          now,
    updatedAt:          now,
  };

  try {
    await getExpenseService().saveClaim(claim);
    return NextResponse.json({ ok: true, id: claim.id }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/webhooks/expenses-submission]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
