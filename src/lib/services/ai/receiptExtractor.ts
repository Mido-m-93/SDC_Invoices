import "server-only";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReceiptExtractedFields {
  amount:    number | null;
  date:      string | null;
  vendor:    string | null;
  recipient: string | null; // 宛名
  purpose:   string | null; // 但し書き
}

export interface ExpenseDataValidation {
  passed:     boolean;
  violations: string[];
  summary:    string;
}

const EMPTY: ReceiptExtractedFields = {
  amount: null, date: null, vendor: null, recipient: null, purpose: null,
};

// ── Prompt ────────────────────────────────────────────────────────────────────

const EXTRACT_PROMPT = `Extract fields from this expense receipt or invoice.

Return ONLY valid JSON — no markdown fences, no explanation:
{
  "amount":    <total charged as a plain number, or null>,
  "date":      "<issue or transaction date as YYYY-MM-DD, or null>",
  "vendor":    "<store, merchant, or issuer name, or null>",
  "recipient": "<宛名 — name the receipt is addressed to; null if blank or 上様>",
  "purpose":   "<items purchased or 但し書き purpose text, or null>"
}
Rules:
- Strip all currency symbols: ¥ ￥ $ 円 → plain number only
- Convert Japanese dates (令和/平成/2026年X月X日) to YYYY-MM-DD
- Set recipient to null for generic placeholders (上様, blank)
- Return null for any field that is absent or ambiguous — do not guess`;

// ── Parse GPT response ────────────────────────────────────────────────────────

function parseFields(text: string): ReceiptExtractedFields {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return EMPTY;
  try {
    const p = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      amount:    typeof p.amount    === "number" ? p.amount    : null,
      date:      typeof p.date      === "string" ? p.date      : null,
      vendor:    typeof p.vendor    === "string" ? p.vendor    : null,
      recipient: typeof p.recipient === "string" ? p.recipient : null,
      purpose:   typeof p.purpose   === "string" ? p.purpose   : null,
    };
  } catch {
    return EMPTY;
  }
}

// ── Format detection ──────────────────────────────────────────────────────────

function isImageMime(mime: string) {
  return /^image\/(jpeg|jpg|png|gif|webp|bmp|tiff)/i.test(mime);
}

function isPdfMime(mime: string) {
  return /application\/pdf/i.test(mime);
}

function guessMediaType(url: string, contentType: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  const extMap: Record<string, string> = {
    pdf:  "application/pdf",
    jpg:  "image/jpeg",
    jpeg: "image/jpeg",
    png:  "image/png",
    gif:  "image/gif",
    webp: "image/webp",
    bmp:  "image/bmp",
    tiff: "image/tiff",
    tif:  "image/tiff",
    heic: "image/heic",
    heif: "image/heif",
  };
  return extMap[ext] ?? contentType.split(";")[0].trim() ?? "application/octet-stream";
}

// ── Auth: add Graph Bearer token for SharePoint URLs ─────────────────────────

function isSharePointUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h.endsWith("sharepoint.com") || h.endsWith("onedrive.live.com") || h.endsWith("1drv.ms");
  } catch { return false; }
}

async function getGraphToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     process.env.AZURE_CLIENT_ID!,
        client_secret: process.env.AZURE_CLIENT_SECRET!,
        grant_type:    "client_credentials",
        scope:         "https://graph.microsoft.com/.default",
      }),
    }
  );
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Graph token request failed");
  return data.access_token;
}

// SharePoint/OneDrive sharing URLs can't be fetched directly with a Graph bearer
// token (that returns 401 — Graph tokens aren't valid against raw SharePoint URLs).
// They must be resolved through the Graph /shares endpoint first, same as
// downloadSharePointFile() in SharePointContractService.ts.
async function fetchSharePointFileBytes(url: string, token: string): Promise<Uint8Array> {
  const encoded = Buffer.from(url)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/shares/u!${encoded}/driveItem/content`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`SharePoint file fetch (shares endpoint) failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ── Main: extract receipt fields from a URL (any format) ─────────────────────
//
// Images  → URL passed directly to GPT-4o vision. No bytes in our code.
// PDFs    → bytes fetched in memory, sent as base64. Nothing saved to disk.
// Other   → same as PDF path (fetch + base64).
//
// SharePoint/OneDrive URLs are resolved via the Graph /shares endpoint.

export async function extractReceiptFields(
  receiptUrl: string,
): Promise<ReceiptExtractedFields> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  if (!receiptUrl) throw new Error("No receipt URL");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const useGraphShares =
    isSharePointUrl(receiptUrl) &&
    !!process.env.AZURE_TENANT_ID &&
    !!process.env.AZURE_CLIENT_ID &&
    !!process.env.AZURE_CLIENT_SECRET;

  let bytes: Uint8Array;
  let mediaType: string;

  if (useGraphShares) {
    const token = await getGraphToken();
    bytes     = await fetchSharePointFileBytes(receiptUrl, token);
    mediaType = guessMediaType(receiptUrl, "");
  } else {
    // ── HEAD request to detect content type without fetching the full body ──
    let headMediaType = "application/octet-stream";
    try {
      const head = await fetch(receiptUrl, { method: "HEAD", cache: "no-store" });
      headMediaType = guessMediaType(receiptUrl, head.headers.get("content-type") ?? "");
    } catch {
      headMediaType = guessMediaType(receiptUrl, "");
    }

    // ── Images: pass URL directly — GPT-4o fetches it, we fetch nothing ────
    if (isImageMime(headMediaType)) {
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: receiptUrl, detail: "high" },
            } as { type: "image_url"; image_url: { url: string; detail: "high" } },
            { type: "text", text: EXTRACT_PROMPT },
          ],
        }],
        max_tokens: 512,
      });
      return parseFields(response.choices[0]?.message?.content ?? "{}");
    }

    // ── PDFs and other formats: fetch bytes in memory → base64 → GPT ────────
    const fileRes = await fetch(receiptUrl, { cache: "no-store" });
    if (!fileRes.ok) throw new Error(`Receipt fetch ${fileRes.status}`);
    mediaType = guessMediaType(receiptUrl, fileRes.headers.get("content-type") ?? headMediaType);
    bytes     = new Uint8Array(await fileRes.arrayBuffer());
  }

  const base64 = Buffer.from(bytes).toString("base64");

  // For images fetched with auth, use chat completions with base64 data URI
  if (isImageMime(mediaType)) {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mediaType};base64,${base64}`, detail: "high" },
          } as { type: "image_url"; image_url: { url: string; detail: "high" } },
          { type: "text", text: EXTRACT_PROMPT },
        ],
      }],
      max_tokens: 512,
    });
    return parseFields(response.choices[0]?.message?.content ?? "{}");
  }

  // PDFs and any other format: use the Responses API with input_file
  const safeMime = isPdfMime(mediaType) ? "application/pdf" : "application/octet-stream";
  const response = await client.responses.create({
    model: "gpt-4o",
    input: [{
      role: "user",
      content: [
        {
          type: "input_file",
          filename: "receipt.pdf",
          file_data: `data:${safeMime};base64,${base64}`,
        },
        { type: "input_text", text: EXTRACT_PROMPT },
      ],
    }],
    max_output_tokens: 512,
  });
  return parseFields(response.output_text ?? "{}");
}

// ── Fallback: GPT-4o text validation when no receipt URL is available ─────────

const VALIDATE_PROMPT = `Review this expense reimbursement submission.

NAME: {name}
AMOUNT: {currency} {amount}
DATE: {date}
CATEGORY: {category}
DESCRIPTION: {description}
PAYMENT METHOD: {paymentMethod}
RECEIPT ATTACHED: {hasReceipt}

Return ONLY valid JSON:
{
  "passed": <true if no issues>,
  "purposeUnclear":   <true if description is vague or missing>,
  "categoryMismatch": <true if description clearly does not match category>,
  "amountSuspicious": <true if amount seems unreasonable for the stated purpose>,
  "summary": "<one sentence conclusion>"
}`;

export async function validateExpenseData(claim: {
  submittedBy:   string;
  amount:        number;
  currency:      string;
  expenseDate:   string;
  category:      string;
  description:   string;
  paymentMethod: string;
  hasReceipt:    boolean;
}): Promise<ExpenseDataValidation> {
  if (!process.env.OPENAI_API_KEY) {
    return { passed: true, violations: [], summary: "OpenAI not configured — skipped." };
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const prompt = VALIDATE_PROMPT
    .replace("{name}",          claim.submittedBy  || "—")
    .replace("{currency}",      claim.currency)
    .replace("{amount}",        String(claim.amount))
    .replace("{date}",          claim.expenseDate  || "—")
    .replace("{category}",      claim.category.replace(/_/g, " "))
    .replace("{description}",   claim.description  || "—")
    .replace("{paymentMethod}", claim.paymentMethod.replace(/_/g, " "))
    .replace("{hasReceipt}",    claim.hasReceipt ? "Yes" : "No");

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 256,
  });

  const text  = response.choices[0]?.message?.content ?? "{}";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { passed: true, violations: [], summary: "Could not parse response." };

  try {
    const p = JSON.parse(match[0]) as {
      passed?: boolean;
      purposeUnclear?: boolean;
      categoryMismatch?: boolean;
      amountSuspicious?: boolean;
      summary?: string;
    };
    const violations: string[] = [];
    if (p.purposeUnclear)   violations.push("PURPOSE_UNCLEAR");
    if (p.categoryMismatch) violations.push("CATEGORY_MISMATCH");
    if (p.amountSuspicious) violations.push("AMOUNT_SUSPICIOUS");
    return {
      passed:  p.passed ?? violations.length === 0,
      violations,
      summary: p.summary ?? (violations.length === 0 ? "Submission looks consistent." : "Issues found."),
    };
  } catch {
    return { passed: true, violations: [], summary: "Parse error — skipped." };
  }
}
