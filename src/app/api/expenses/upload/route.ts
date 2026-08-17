// POST /api/expenses/upload
// Accepts an Excel or CSV file exported from Microsoft Forms (RC経費精算).
//
// Form columns (as they appear in the Excel export):
//   Start time             → submittedAt  (Excel serial, JST offset)
//   Email                  → submittedByEmail
//   お名前(Name)           → submittedBy
//   金額( Amount)          → amount
//   日付( Date)            → expenseDate
//   領収書の添付(...)       → receiptUrl
//   備考交通費を申請...     → description (route / notes)
//   振込先銀行口座(...)     → bankAccount

import { NextRequest, NextResponse } from "next/server";
import { read, utils } from "xlsx";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import iconv from "iconv-lite";
import { generateId } from "@/lib/utils";
import type { ExpenseClaim, ExpenseCategory } from "@/types";
import { getExpenseService } from "@/lib/services";

export const dynamic = "force-dynamic";

// ── Encoding detection (same as invoice upload) ───────────────────────────────
function decodeBuffer(buffer: Buffer): { text: string; encoding: string } {
  if (buffer[0] === 0xFF && buffer[1] === 0xFE)
    return { text: new TextDecoder("utf-16le").decode(buffer.slice(2)), encoding: "utf-16le" };
  if (buffer[0] === 0xFE && buffer[1] === 0xFF)
    return { text: new TextDecoder("utf-16be").decode(buffer.slice(2)), encoding: "utf-16be" };
  const start = (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) ? 3 : 0;
  const slice = buffer.slice(start);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(slice);
    return { text: new TextDecoder("utf-8").decode(slice), encoding: start === 3 ? "utf-8-bom" : "utf-8" };
  } catch {
    return { text: iconv.decode(slice, "shift_jis"), encoding: "shift_jis" };
  }
}

// ── CSV parser (same as invoice upload) ───────────────────────────────────────
function parseCSVText(text: string): Record<string, string>[] {
  const input = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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

// ── Column keyword mapping ────────────────────────────────────────────────────
// Ordered most-specific first. "Name" is last because MS Forms also auto-adds
// a respondent "Name" column — "お名前" wins because it's longer.
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
  // Most generic — must come last so it doesn't steal Email / Amount matches
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

// ── Value converters ──────────────────────────────────────────────────────────

// "Start time" is stored as a JST serial in the MS Forms Excel export.
// Subtract 9 h so the ISO string represents the correct UTC instant.
function serialToISO(value: string): string {
  const num = Number(value);
  if (!isNaN(num) && num > 40000) {
    return new Date((num - 25569) * 86400_000 - 9 * 3_600_000).toISOString();
  }
  if (/^\d{4}/.test(value)) return new Date(value.replace(/\//g, "-")).toISOString();
  return new Date().toISOString();
}

// Expense date field (M/d/yyyy from form, or serial from Excel cell)
function serialToDate(value: string): string {
  const num = Number(value);
  if (!isNaN(num) && num > 40000) {
    const d = new Date(Math.round((num - 25569) * 86400_000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  // "6/5/2026" → "2026-06-05"
  const mdy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  if (/^\d{4}[\/\-]/.test(value)) return value.replace(/\//g, "-").slice(0, 10);
  return value;
}

function parseAmount(value: string): number {
  const num = parseFloat(value.replace(/[^0-9.]/g, ""));
  return isNaN(num) ? 0 : num;
}

// Infer category from the 備考 field (transport route patterns → transport;
// meal/entertainment keywords → meals; everything else → other).
function inferCategory(description: string): ExpenseCategory {
  const v = description;
  // Transport: route pattern (→, ↔, から…まで, station names, or explicit keywords)
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
  if (!submittedBy) return null; // skip empty / header-only rows

  const description = get("description");
  const receiptRaw  = get("receiptUrl");
  const now         = new Date().toISOString();

  // Policy violations detected at import time
  const category        = inferCategory(description);
  const isNoReceiptTransport =
    category === "transport" && /[→↔]|電車|バス|train|bus|subway|公共交通|metro|路線/i.test(description);
  const violations: string[] = [];
  if (!receiptRaw && !isNoReceiptTransport) violations.push("MISSING_RECEIPT");

  return {
    id:                 generateId("exp"),
    submittedBy,
    submittedByEmail:   get("submittedByEmail"),
    submittedAt:        serialToISO(get("submittedAt")) || now,
    category,
    description,
    amount:             parseAmount(get("amount")),
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

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file     = formData.get("file");
    if (!file || typeof file === "string")
      return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const blob     = file as Blob;
    const fileName = (blob as File).name ?? "";
    const buffer   = Buffer.from(await blob.arrayBuffer());
    const isCSV    = /\.csv$/i.test(fileName);

    let rows: Record<string, unknown>[];
    if (isCSV) {
      const { text } = decodeBuffer(buffer);
      rows = parseCSVText(text);
    } else {
      const workbook  = read(buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName)
        return NextResponse.json({ error: "No sheets found in workbook" }, { status: 400 });
      rows = utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: "" });
    }

    const detectedHeaders = rows.length > 0 ? Object.keys(rows[0]) : [];
    const fieldMap        = buildFieldMap(detectedHeaders);
    const headerMapping   = Object.fromEntries(
      detectedHeaders.map((h) => [h, fieldMap.get(h) ?? "(unmapped)"])
    );

    console.log("[expenses/upload] detectedHeaders:", JSON.stringify(detectedHeaders));
    console.log("[expenses/upload] headerMapping:",   JSON.stringify(headerMapping));

    const claims: ExpenseClaim[] = rows
      .map((row, i) => mapRow(row as Record<string, unknown>, fieldMap, i))
      .filter((c): c is ExpenseClaim => c !== null);

    if (claims.length === 0) {
      return NextResponse.json(
        { error: "0 rows matched — column headers not recognised.", detectedHeaders, headerMapping },
        { status: 422 }
      );
    }

    const svc = getExpenseService();
    await Promise.all(claims.map((c) => svc.saveClaim(c)));

    console.log(`[expenses/upload] Saved ${claims.length} claims from "${fileName}"`);
    return NextResponse.json({ count: claims.length, claims, detectedHeaders, headerMapping });
  } catch (err) {
    console.error("[POST /api/expenses/upload]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
