// Shared Microsoft Forms column/question keyword mapping.
// Used by the Excel-based sync path (MicrosoftSheetsService, manual upload)
// and the Forms-webhook path — same Form questions, same header text, same
// matching rules either way.
import type { InvoiceSubmission } from "@/types";

export type FieldName = keyof InvoiceSubmission | "email";

// Matches your exact Microsoft Forms column headers (bilingual Japanese/English).
// Most-specific rules first to avoid false matches. When two headers match the
// same field, the longer one wins — this ensures "Name1" (custom question)
// beats "Name" (MS Forms built-in).
export const KEYWORD_RULES: Array<{ keywords: string[]; field: FieldName }> = [
  { keywords: ["Start time", "開始時刻"],                                                     field: "submittedAt" },
  { keywords: ["Email Address", "メールアドレス"],                                            field: "email" },
  { keywords: ["Invoice Amount", "請求金額"],                                                 field: "claimedAmountTaxIncluded" },
  { keywords: ["Currency", "通貨", "currency"],                                               field: "currency" },
  { keywords: ["Which month", "invoice cover", "稼働月", "対象月"],                           field: "closingMonth" },
  { keywords: ["Invoice Category", "Internal Project or External", "内訳"],                  field: "projectType" },
  { keywords: ["For Internal Projects Only", "内部案件の場合のみ", "内部案件の場合"],          field: "internalDepartment" },
  { keywords: ["For External Projects Only", "select the project name", "外部案件の場合のみ", "外部案件の場合"], field: "externalProjectName" },
  { keywords: ["Invoice Attachment", "upload only one invoice", "請求書の添付", "請求書ファイル"], field: "invoiceAttachment" },
  { keywords: ["Additional Notes", "特記事項", "備考"],                                       field: "notes" },
  { keywords: ["Name", "名前"],                                                               field: "payerName" },
];

export function normalizeHeader(h: string): string {
  return h.replace(/\r\n/g, " ").replace(/\s+/g, " ").trim();
}

export function buildFieldMap(headers: string[]): Map<string, FieldName> {
  const map = new Map<string, FieldName>();
  const bestLength = new Map<FieldName, number>();
  for (const header of headers) {
    const lower = normalizeHeader(header).toLowerCase();
    for (const rule of KEYWORD_RULES) {
      if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
        const prev = bestLength.get(rule.field) ?? 0;
        if (header.length > prev) {
          for (const [h, f] of Array.from(map.entries())) {
            if (f === rule.field) { map.delete(h); break; }
          }
          map.set(header, rule.field);
          bestLength.set(rule.field, header.length);
        }
        break;
      }
    }
  }
  return map;
}
