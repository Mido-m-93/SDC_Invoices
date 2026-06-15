// ─────────────────────────────────────────────────────────────────────────────
// lib/services/ai/pdfExtractor.ts — PDF field extraction
//
// Two strategies, selected automatically at runtime:
//
//   1. Google Document AI  — if GOOGLE_DOCUMENT_AI_PROJECT_ID +
//                            GOOGLE_DOCUMENT_AI_PROCESSOR_ID are set.
//                            Reuses GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY.
//
//   2. Claude (PDF native) — fallback. Sends the raw PDF bytes directly to
//                            Claude as a document — no pdf-parse needed.
//                            Requires ANTHROPIC_API_KEY.
//
// Activation (Vercel env vars):
//   NEXT_PUBLIC_USE_MOCK_VALIDATION=false      → enables real validation
//   NEXT_PUBLIC_USE_MOCK_DRIVE=false           → fetches real PDFs from Drive
//   ANTHROPIC_API_KEY                          → required for Claude path
//   GOOGLE_DOCUMENT_AI_PROJECT_ID              → required for Google Doc AI
//   GOOGLE_DOCUMENT_AI_PROCESSOR_ID            → required for Google Doc AI
//   GOOGLE_DOCUMENT_AI_LOCATION                → optional, defaults to "us"
//   GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY   → shared with Drive service
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedInvoiceFields } from "@/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyExtracted(rawText = ""): ExtractedInvoiceFields {
  return {
    invoiceDate: null,
    subtotal: null,
    taxAmount: null,
    total: null,
    taxRate: null,
    payeeName: null,
    payerNameOnDoc: null,
    rawText,
  };
}

function parseCurrencyStr(str: string | null | undefined): number | null {
  if (!str) return null;
  const cleaned = str.replace(/[¥￥,、\s円]/g, "").replace(/[^\d.]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function normalizeDate(str: string | null | undefined): string | null {
  if (!str) return null;
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return str;
}

// ── Strategy 1: Claude with native PDF support ────────────────────────────────
// Claude reads the PDF bytes directly — no text extraction step needed.

export async function extractWithClaude(pdfBytes: Uint8Array): Promise<ExtractedInvoiceFields> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: Buffer.from(pdfBytes).toString("base64"),
            },
          },
          {
            type: "text",
            text: `Extract invoice fields from this PDF and return ONLY valid JSON — no markdown, no explanation.

{
  "invoiceDate": "YYYY-MM-DD or null",
  "subtotal": number or null,
  "taxAmount": number or null,
  "total": number or null,
  "taxRate": number or null,
  "payeeName": "company being billed or null",
  "payerNameOnDoc": "company issuing the invoice or null",
  "rawText": "first 500 chars of visible text or empty string"
}

Rules:
- All monetary amounts must be plain numbers (no symbols or commas)
- invoiceDate must be YYYY-MM-DD
- taxRate is a decimal (0.1 for 10%)
- Return null for anything you cannot find with confidence`,
          },
        ] as Anthropic.ContentBlockParam[],
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as Record<string, unknown>) : {};
  } catch {
    return emptyExtracted();
  }

  return {
    invoiceDate: typeof parsed.invoiceDate === "string" ? parsed.invoiceDate : null,
    subtotal: typeof parsed.subtotal === "number" ? parsed.subtotal : null,
    taxAmount: typeof parsed.taxAmount === "number" ? parsed.taxAmount : null,
    total: typeof parsed.total === "number" ? parsed.total : null,
    taxRate: typeof parsed.taxRate === "number" ? parsed.taxRate : null,
    payeeName: typeof parsed.payeeName === "string" ? parsed.payeeName : null,
    payerNameOnDoc: typeof parsed.payerNameOnDoc === "string" ? parsed.payerNameOnDoc : null,
    rawText: typeof parsed.rawText === "string" ? parsed.rawText : "",
  };
}

// ── Strategy 2: Google Document AI ───────────────────────────────────────────

async function getGoogleAccessToken(): Promise<string> {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY are required for Google Document AI");
  }

  const { createSign } = await import("crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  ).toString("base64url");

  const signingInput = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign.sign(privateKey, "base64url");
  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) throw new Error(`Google OAuth token request failed: ${tokenRes.status}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  return access_token;
}

export async function extractWithGoogleDocumentAI(pdfBytes: Uint8Array): Promise<ExtractedInvoiceFields> {
  const projectId = process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID!;
  const processorId = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID!;
  const location = process.env.GOOGLE_DOCUMENT_AI_LOCATION ?? "us";

  const accessToken = await getGoogleAccessToken();
  const endpoint = `https://${location}-documentai.googleapis.com/v1/projects/${projectId}/locations/${location}/processors/${processorId}:process`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      rawDocument: {
        content: Buffer.from(pdfBytes).toString("base64"),
        mimeType: "application/pdf",
      },
    }),
  });

  if (!res.ok) throw new Error(`Document AI request failed: ${res.status} ${await res.text()}`);

  const result = (await res.json()) as {
    document?: { text?: string; entities?: Array<{ type: string; mentionText: string }> };
  };

  const document = result.document ?? {};
  const rawText = document.text ?? "";
  const entities = document.entities ?? [];
  const get = (...types: string[]) =>
    types.map((t) => entities.find((e) => e.type === t)?.mentionText).find(Boolean) ?? null;

  return {
    invoiceDate: normalizeDate(get("invoice_date", "due_date")),
    subtotal: parseCurrencyStr(get("subtotal", "subtotal_amount")),
    taxAmount: parseCurrencyStr(get("total_tax_amount", "tax_amount")),
    total: parseCurrencyStr(get("total_amount", "net_amount")),
    taxRate: null,
    payeeName: get("receiver_name", "bill_to_name"),
    payerNameOnDoc: get("supplier_name", "vendor_name"),
    rawText,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────
// Google Document AI first (if configured), Claude PDF native as fallback.

export async function extractFromPdf(pdfBytes: Uint8Array): Promise<ExtractedInvoiceFields> {
  const hasGoogleDocAI =
    !!process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID &&
    !!process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;

  if (hasGoogleDocAI) {
    try {
      return await extractWithGoogleDocumentAI(pdfBytes);
    } catch (err) {
      console.warn("[pdfExtractor] Google Document AI failed, falling back to Claude:", err);
    }
  }

  return extractWithClaude(pdfBytes);
}
