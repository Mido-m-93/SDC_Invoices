// ─────────────────────────────────────────────────────────────────────────────
// lib/services/ai/pdfExtractor.ts — PDF field extraction
//
// Groq only (free tier LLM; requires GROQ_API_KEY). Text is extracted
// locally via unpdf, then parsed by Groq's LLM — no vision/OCR fallback, so a
// scanned (image-only) PDF yields no fields.
// ─────────────────────────────────────────────────────────────────────────────

import { detectCurrency } from "@/lib/utils";
import type { ExtractedInvoiceFields } from "@/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyExtracted(rawText = ""): ExtractedInvoiceFields {
  return {
    invoiceDate: null,
    subtotal: null,
    taxAmount: null,
    total: null,
    taxRate: null,
    memberName: null,
    payerNameOnDoc: null,
    rawText,
    currency: detectCurrency(rawText),
  };
}

function parseCurrencyStr(str: string | null | undefined): number | null {
  if (!str) return null;
  const cleaned = str.replace(/[¥￥,、\s円]/g, "").replace(/[^\d.]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// Claude sometimes returns numeric fields as strings (e.g., "216" or "216 USD").
// This accepts both number and string forms so we don't miss amounts.
function parseNumericField(val: unknown): number | null {
  if (typeof val === "number") return isNaN(val) ? null : val;
  if (typeof val === "string") return parseCurrencyStr(val);
  return null;
}

function normalizeDate(str: string | null | undefined): string | null {
  if (!str) return null;
  // Japanese date: "2026年4月1日" or "2026年4月-01" (mixed format from AI)
  const jpMatch = str.match(/(\d{4})年(\d{1,2})月[\-\s]?(\d{1,2})日?/);
  if (jpMatch) {
    const year  = jpMatch[1];
    const month = jpMatch[2].padStart(2, "0");
    const day   = jpMatch[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  // Slash-formatted date (e.g. "6/6/2026", captured from a raw label match —
  // this org's own invoices use day-first, confirmed by unambiguous dates
  // like "18/4/2026" elsewhere in the same documents). Parsed manually and
  // built with explicit numeric fields instead of the generic `new Date(str)`
  // fallback below, which parses as local midnight and can shift the date by
  // a day once converted to UTC depending on the server's timezone.
  const slash = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, dd, mm, yyyy] = slash;
    const day = parseInt(dd, 10), month = parseInt(mm, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${yyyy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return str;
}

// ── Regex fallbacks — applied when Groq returns null for a field ─────────────
// These run on rawText already extracted locally, so no extra API call needed.
// Label-anchored (start of line, not a bare scan) so a document with several
// dates/names doesn't return whichever one happens to appear first — e.g. an
// unanchored date scan would just as easily grab a due date or period date
// instead of the issue date.

function extractLabeledLine(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`^\\s*${label}\\s*[：:]\\s*(.+)$`, "im");
    const m = text.match(re);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

const DATE_LABELS = ["Issue Date", "Invoice Date", "Date issued", "請求日", "発行日"];
const NAME_LABELS = ["Name", "氏名", "名前", "請求者", "発行者", "From", "Issued by"];

function fallbackDate(text: string): string | null {
  if (!text) return null;
  const labeled = extractLabeledLine(text, DATE_LABELS);
  return labeled ? normalizeDate(labeled) : null;
}

function fallbackMemberName(text: string): string | null {
  if (!text) return null;
  return extractLabeledLine(text, NAME_LABELS);
}

function fallbackAmounts(text: string): { total: number | null; subtotal: number | null; taxAmount: number | null } {
  if (!text) return { total: null, subtotal: null, taxAmount: null };
  // Collect all numbers that look like currency (4+ digits, optionally with commas or ¥ prefix)
  const re = /[¥￥]?\s*([\d]{1,3}(?:[,，][\d]{3})+|[\d]{4,})\s*円?/g;
  const found: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseFloat(m[1].replace(/[,，]/g, ""));
    if (!isNaN(n) && n >= 1000) found.push(n);
  }
  if (found.length === 0) return { total: null, subtotal: null, taxAmount: null };
  // Largest number is the most likely total; second-largest is the most likely subtotal
  const sorted = [...new Set(found)].sort((a, b) => b - a);
  const total    = sorted[0] ?? null;
  const subtotal = sorted[1] ?? null;
  // Heuristic: if total ≈ subtotal × 1.1 (10% tax), derive taxAmount
  const taxAmount =
    total !== null && subtotal !== null && Math.abs(total - subtotal * 1.1) < total * 0.05
      ? Math.round(total - subtotal)
      : null;
  return { total, subtotal, taxAmount };
}

// Numbers with an explicit currency unit right next to them (¥1,000 / 216 USD
// / 500円) are unambiguous — unlike phone numbers, UPI IDs, or bank account
// numbers, nothing else in an invoice gets tagged this way. Used as a
// deterministic check against the LLM's claimed total: telling it not to
// confuse identifiers with amounts (in the prompt) doesn't reliably stop it
// from doing so anyway, but a plain untagged 10-digit phone number will never
// show up here, so this catches it regardless of what the LLM says. Returned
// most-repeated-first, since a real total/line-item amount typically recurs
// (unit price, then again in a totals row) while a misread identifier won't.
function extractCurrencyTaggedAmounts(text: string): number[] {
  if (!text) return [];
  const re = /(?:[¥￥$]\s*([\d,，]+(?:\.\d+)?)|([\d,，]+(?:\.\d+)?)\s*(?:円|USD|JPY|EUR))/gi;
  const counts = new Map<number, number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseFloat((m[1] ?? m[2]).replace(/[,，]/g, ""));
    if (!isNaN(n)) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

// ── Text extraction helper (used by Groq path) ───────────────────────────────
// unpdf bundles its own pdfjs-dist build specifically configured for
// serverless/edge runtimes — no worker, no canvas/DOMMatrix polyfill needed.
// Plain pdfjs-dist required several increasingly elaborate workarounds here
// (a DOMMatrix polyfill, then hand-resolving its worker script around two
// different bundlers' static analysis) and still didn't work reliably on
// Vercel; unpdf exists specifically to avoid all of that.

async function extractTextFromPdf(pdfBytes: Uint8Array): Promise<string> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(pdfBytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

// ── Strategy 1: Groq (free tier) ─────────────────────────────────────────────
// Extracts text with unpdf, then sends to Groq's LLM for field parsing.

async function extractWithGroq(pdfBytes: Uint8Array): Promise<ExtractedInvoiceFields> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set");
  }

  const rawText = await extractTextFromPdf(pdfBytes);
  if (!rawText.trim()) {
    // Groq has no vision path, so a scanned (image-only) PDF has no text to
    // work with at all — fail clearly rather than silently returning an
    // all-null result that looks like a successful-but-empty extraction.
    throw new Error("Groq: no text extracted from PDF (may be a scanned image)");
  }

  const Groq = (await import("groq-sdk")).default;
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const response = await client.chat.completions.create({
    model: "openai/gpt-oss-120b",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Extract invoice fields from the text below and return ONLY valid JSON — no markdown, no explanation.

${rawText.slice(0, 8000)}

Return exactly this JSON:
{
  "invoiceDate": "YYYY-MM-DD or null",
  "subtotal": number or null,
  "taxAmount": number or null,
  "total": number or null,
  "taxRate": number or null,
  "memberName": "the person/company who ISSUED this invoice and receives payment (look for: 氏名, 名前, 請求者, 発行者, Name, From, Issued by) or null",
  "payerNameOnDoc": "the company/person being BILLED (look for: 御中, 宛名, 請求先, To, Bill To) or null",
  "rawText": "first 500 chars of the invoice text"
}

Rules:
- Amounts: plain numbers only, strip ¥ ￥ , 円
- invoiceDate: YYYY-MM-DD; return null if no field explicitly labeled 請求日, 発行日, Issue Date, Invoice Date, or Date issued is found — do NOT guess from context dates. The label may use a full-width colon (：) or have extra whitespace around it.
- taxRate: decimal (0.10 for 10%, 0.08 for 8%)
- total: if only one amount exists, use it as the total
- CRITICAL: phone numbers, UPI/payment IDs, bank account numbers, invoice/reference numbers, and postal codes are NEVER amounts — ignore them completely for subtotal/taxAmount/total, even if they appear right next to a "Total"/"Amount"/合計/請求金額 label. A real amount is the smallest number that plausibly prices the described goods/service (often repeated earlier in the document as a unit price or line-item amount) — long unformatted digit strings without any currency symbol, comma grouping, or explicit "○○円"/"$XXX"/"XXX USD" phrasing are identifiers, not amounts.
- Return null only when a field is genuinely absent`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as Record<string, unknown>) : {};
  } catch {
    console.warn("[pdfExtractor] Groq response JSON parse failed:", text.slice(0, 200));
    return emptyExtracted(rawText.slice(0, 1000));
  }

  const groqDate     = normalizeDate(typeof parsed.invoiceDate === "string" ? parsed.invoiceDate : null) ?? fallbackDate(rawText);
  const groqMember   = (typeof parsed.memberName === "string" ? parsed.memberName : null) ?? fallbackMemberName(rawText);
  const groqTotal    = parseNumericField(parsed.total);
  const groqSubtotal = parseNumericField(parsed.subtotal);
  const groqTax      = parseNumericField(parsed.taxAmount);
  const regexAmounts = (groqTotal === null || groqSubtotal === null || groqTax === null)
    ? fallbackAmounts(rawText)
    : { total: null, subtotal: null, taxAmount: null };

  // The prompt tells the model identifiers (phone/UPI/bank/reference numbers)
  // are never amounts, but it doesn't reliably follow that — check every
  // amount against numbers actually tagged with a currency unit in the text
  // instead of just trusting it. Frequency-sorted (most-repeated first) for
  // total (a real total tends to recur — unit price, then a totals row);
  // value-sorted (largest first) for subtotal, mirroring fallbackAmounts'
  // existing "largest = total, second-largest = subtotal" heuristic.
  const taggedAmounts    = extractCurrencyTaggedAmounts(rawText);
  const taggedByValue    = [...taggedAmounts].sort((a, b) => b - a);

  function verified(claimed: number | null, fallback: number | null, field: string): number | null {
    if (taggedAmounts.length === 0 || (claimed !== null && taggedAmounts.includes(claimed))) return claimed;
    console.warn(`[pdfExtractor] Groq ${field} ${claimed} isn't currency-tagged in the text, overriding with ${fallback}`);
    return fallback;
  }

  const total = verified(groqTotal ?? regexAmounts.total, taggedAmounts[0] ?? null, "total");
  // Second-largest tagged amount if there are at least two distinct ones;
  // otherwise there's only one real amount in the document at all, so no tax
  // breakdown exists — subtotal is just the total.
  const subtotal = verified(groqSubtotal ?? regexAmounts.subtotal, taggedByValue[1] ?? total, "subtotal");
  // Unlike total/subtotal, a wrong tax guess has no good fallback number —
  // null (not found) is safer than a wildly wrong one.
  const taxAmount = verified(groqTax ?? regexAmounts.taxAmount, null, "taxAmount");

  return {
    invoiceDate: groqDate,
    subtotal,
    taxAmount,
    total,
    taxRate:        parseNumericField(parsed.taxRate),
    memberName:     groqMember,
    payerNameOnDoc: typeof parsed.payerNameOnDoc === "string" ? parsed.payerNameOnDoc : null,
    rawText:        rawText.slice(0, 1000),
    // Detected from the PDF's own text, not the LLM's output — same
    // reasoning as the currency-tagged amount checks above: the document
    // itself says "USD"/"¥"/"円" far more reliably than the model reports it.
    currency: detectCurrency(rawText),
  };
}

// Contract field extraction (ExtractedContractFields / extractContractFields)
// lives in ./contractExtractor.ts, following the same Groq-only pattern.

// ── Main entry point ──────────────────────────────────────────────────────────

export async function extractFromPdf(pdfBytes: Uint8Array): Promise<ExtractedInvoiceFields> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set — required, since it's the only extraction strategy in use.");
  }
  return await extractWithGroq(pdfBytes);
}
