export const dynamic = "force-dynamic";

// src/app/api/invoices/upload/route.ts
// POST /api/invoices/upload
// Accepts a CSV or Excel file exported from Microsoft Forms,
// parses it with a Unicode-safe parser, maps columns to InvoiceSubmission[].

import { NextRequest, NextResponse } from "next/server";
import { read, utils } from "xlsx";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import iconv from "iconv-lite";
import { generateId, parseSnapshotMonth } from "@/lib/utils";
import type { InvoiceSubmission } from "@/types";
import { getStorageService } from "@/lib/services";

// â”€â”€ Encoding detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function decodeBuffer(buffer: Buffer): { text: string; encoding: string } {
  // Check for explicit BOM
  if (buffer[0] === 0xFF && buffer[1] === 0xFE)
    return { text: new TextDecoder("utf-16le").decode(buffer.slice(2)), encoding: "utf-16le" };
  if (buffer[0] === 0xFE && buffer[1] === 0xFF)
    return { text: new TextDecoder("utf-16be").decode(buffer.slice(2)), encoding: "utf-16be" };

  const start = (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) ? 3 : 0;
  const slice = buffer.slice(start);

  // Check if the buffer is valid UTF-8 by trying a fatal decode
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(slice);
    // No error â†’ valid UTF-8
    return {
      text: new TextDecoder("utf-8").decode(slice),
      encoding: start === 3 ? "utf-8-bom" : "utf-8",
    };
  } catch {
    // Invalid UTF-8 â€” assume Shift-JIS (CP932), common for Japanese Excel CSV on Windows
    return { text: iconv.decode(slice, "shift_jis"), encoding: "shift_jis" };
  }
}

// â”€â”€ Pure-JS CSV parser â€” handles quoted multiline fields (RFC 4180) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Microsoft Forms CSV headers contain embedded newlines (e.g. "For External
// Projects Only:\nPlease select the project name."). A simple line-split
// breaks those headers. This parser scans char-by-char so quoted newlines survive.
function parseCSVText(text: string): Record<string, string>[] {
  const input = text.replace(/^ï»¿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const allRows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") {
        row.push(field); field = "";
        if (row.some((f) => f.trim() !== "")) allRows.push(row);
        row = [];
      } else { field += ch; }
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) allRows.push(row);

  if (allRows.length === 0) return [];
  const headers = allRows[0];
  return allRows.slice(1).map((vals) => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => { record[h.trim()] = (vals[i] ?? "").trim(); });
    return record;
  });
}

// â”€â”€ Column keyword matching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
type FieldName = keyof InvoiceSubmission | "email";

// Matches your exact Microsoft Forms column headers (bilingual Japanese/English).
// Most-specific rules first to avoid false matches.
const KEYWORD_RULES: Array<{ keywords: string[]; field: FieldName }> = [
  { keywords: ["Start time", "é–‹å§‹æ™‚åˆ»"],                                                    field: "submittedAt" },
  { keywords: ["Email Address", "ãƒ¡ãƒ¼ãƒ«ã‚¢ãƒ‰ãƒ¬ã‚¹"],                                           field: "email" },
  { keywords: ["Invoice Amount", "è«‹æ±‚é‡‘é¡"],                                                field: "claimedAmountTaxIncluded" },
  { keywords: ["Which month", "invoice cover", "ç¨¼åƒæœˆ", "å¯¾è±¡æœˆ"],                          field: "closingMonth" },
  { keywords: ["Invoice Category", "Internal Project or External", "å†…è¨³"],                 field: "projectType" },
  { keywords: ["For Internal Projects Only", "å†…éƒ¨æ¡ˆä»¶ã®å ´åˆã®ã¿"],                           field: "internalDepartment" },
  { keywords: ["For External Projects Only", "select the project name", "å¤–éƒ¨æ¡ˆä»¶ã®å ´åˆã®ã¿"],field: "externalProjectName" },
  { keywords: ["upload only one invoice", "supported files (PDF)", "Invoice Attachment", "è«‹æ±‚æ›¸ã®æ·»ä»˜", "è«‹æ±‚æ›¸ãƒ•ã‚¡ã‚¤ãƒ«"], field: "invoiceAttachment" },
  { keywords: ["Additional Notes", "ç‰¹è¨˜äº‹é …", "å‚™è€ƒ"],                                      field: "notes" },
  { keywords: ["Name", "åå‰"],                                                              field: "payerName" },
];

function buildFieldMap(headers: string[]): Map<string, FieldName> {
  const map = new Map<string, FieldName>();
  for (const header of headers) {
    const lower = header.toLowerCase();
    for (const rule of KEYWORD_RULES) {
      if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
        if (!map.has(header)) map.set(header, rule.field);
        break;
      }
    }
  }
  return map;
}

// â”€â”€ Date conversion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function convertExcelDate(value: string): string {
  const num = Number(value);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    return `${date.getUTCFullYear()}å¹´${date.getUTCMonth() + 1}æœˆ`;
  }
  return value;
}

function mapRow(row: Record<string, unknown>, fieldMap: Map<string, FieldName>, rowIndex: number): InvoiceSubmission {
  const values = new Map<FieldName, string>();
  for (const [header, field] of Array.from(fieldMap)) {
    const val = (row[header] ?? "").toString().trim();
    if (val !== "") values.set(field, val);
  }
  const get = (f: FieldName) => values.get(f) ?? "";
  return {
    id: generateId(),
    submissionRowNumber: rowIndex + 2,
    submittedAt:              get("submittedAt") || undefined,
    email:                    get("email"),
    payerName:                get("payerName"),
    closingMonth:             convertExcelDate(get("closingMonth")),
    invoiceAttachment:        get("invoiceAttachment"),
    notes:                    get("notes"),
    internalDepartment:       get("internalDepartment"),
    externalProjectName:      get("externalProjectName"),
    projectType:              get("projectType"),
    claimedAmountTaxIncluded: get("claimedAmountTaxIncluded"),
    invoiceProjectStatus:     "",
    paymentStatus:            "",
    paymentAmount:            "",
    paymentProcessingStatus:  "",
  };
}

// â”€â”€ Route handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string")
      return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const blob = file as Blob;
    const fileName = (blob as File).name ?? "";
    const buffer = Buffer.from(await blob.arrayBuffer());
    const isCSV = /\.(csv)$/i.test(fileName);

    let rows: Record<string, unknown>[];
    let rawPreview = "";

    if (isCSV) {
      const { text, encoding } = decodeBuffer(buffer);
      const firstLines = text.split(/\r?\n/).slice(0, 2);
      rawPreview = `[encoding:${encoding}] Line1(${firstLines[0]?.length}chars): ${firstLines[0]?.substring(0, 200)} | Line2: ${firstLines[1]?.substring(0, 100)}`;
      rows = parseCSVText(text);
    } else {
      const workbook = read(buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName)
        return NextResponse.json({ error: "No sheets found in workbook" }, { status: 400 });
      rows = utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: "" });
    }

    const detectedHeaders = rows.length > 0 ? Object.keys(rows[0]) : [];
    const fieldMap = buildFieldMap(detectedHeaders);
    const headerMapping = Object.fromEntries(
      detectedHeaders.map((h) => [h, fieldMap.get(h) ?? "(unmapped)"])
    );

    const submissions = rows
      .map((row, i) => mapRow(row as Record<string, unknown>, fieldMap, i))
      .filter((s) => s.payerName !== "");

    // Derive YYYY-MM month from first submission's closingMonth for storage key.
    // Handles: "2026å¹´5æœˆ", "2026-05", "2026-05-01", "4/23/26" (MM/DD/YY), "04/2026"
    const firstMonth = submissions[0]?.closingMonth ?? "";
    const snapshotMonth = parseSnapshotMonth(firstMonth);

    await getStorageService().saveSubmissions(submissions, snapshotMonth);

    return NextResponse.json({ count: submissions.length, submissions, snapshotMonth, detectedHeaders, headerMapping, rawPreview });
  } catch (err) {
    console.error("[POST /api/invoices/upload]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
