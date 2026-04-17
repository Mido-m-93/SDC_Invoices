// ─────────────────────────────────────────────────────────────────────────────
// lib/services/real/SheetsService.ts — Real Google Sheets integration
//
// Activate by setting NEXT_PUBLIC_USE_MOCK_SHEETS=false in .env.local
// and providing the required Google credentials (see env vars below).
//
// Required env vars:
//   GOOGLE_CLIENT_EMAIL          Service account email
//   GOOGLE_PRIVATE_KEY           PEM private key (with literal \n for newlines)
//   GOOGLE_SPREADSHEET_ID        ID from the spreadsheet URL
//
// Optional env vars:
//   GOOGLE_SHEET_NAME            Tab name to read (default: "シート1")
//   GOOGLE_SHEET_RANGE           A1 range to read  (default: "A1:Z")
//   GOOGLE_SHEET_HEADER_ROW      1-based row that contains column headers (default: 1)
//
// Install:
//   npm install googleapis
// ─────────────────────────────────────────────────────────────────────────────

import { google, Auth } from "googleapis";
import type { ISheetsService } from "../types";
import type { InvoiceSubmission } from "@/types";

// ── Column mapping ────────────────────────────────────────────────────────────
// Maps every known Japanese column header to its normalized internal field name.
// Keys must exactly match the header row in the spreadsheet (including spaces,
// brackets, and punctuation). Add or rename entries here if the sheet changes.

export const COLUMN_MAP: Readonly<Record<string, keyof InvoiceSubmission | null>> = {
  "名前":                                                "payerName",
  "請求書の対象月末(締め日)を選択して下さい":               "closingMonth",
  "請求書の添付":                                         "invoiceAttachment",
  "その他特記事項（何かあれば記載してください）":            "notes",
  "※内部案件の場合のみ 部門を選択して下さい。":             "internalDepartment",
  "※外部案件の場合のみ 案件名を選択してください。":          "externalProjectName",
  "請求書の内訳(内部案件or外部案件)":                      "projectType",
  "請求金額(税込) ※請求通貨で記入":                        "claimedAmountTaxIncluded",
  "請求書の案件を":                                        "invoiceProjectStatus",
  "支払":                                                 "paymentStatus",
  "金額":                                                 "paymentAmount",
  "支払処理":                                             "paymentProcessingStatus",
};

// ── Config ────────────────────────────────────────────────────────────────────
interface SheetsConfig {
  spreadsheetId: string;
  sheetName: string;
  range: string;       // A1 notation, without sheet prefix (e.g. "A1:Z")
  headerRow: number;   // 1-based row index of the header row in the range
}

function loadConfig(): SheetsConfig {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error(
      "[RealSheetsService] Missing required env var: GOOGLE_SPREADSHEET_ID\n" +
      "Set it in .env.local or your Cloud Run environment."
    );
  }

  const rawHeaderRow = process.env.GOOGLE_SHEET_HEADER_ROW;
  const headerRow = rawHeaderRow ? parseInt(rawHeaderRow, 10) : 1;
  if (isNaN(headerRow) || headerRow < 1) {
    throw new Error(
      `[RealSheetsService] GOOGLE_SHEET_HEADER_ROW must be a positive integer, got: "${rawHeaderRow}"`
    );
  }

  return {
    spreadsheetId,
    sheetName: process.env.GOOGLE_SHEET_NAME ?? "シート1",
    range: process.env.GOOGLE_SHEET_RANGE ?? "A1:Z",
    headerRow,
  };
}

function loadCredentials(): { clientEmail: string; privateKey: string } {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail) {
    throw new Error(
      "[RealSheetsService] Missing required env var: GOOGLE_CLIENT_EMAIL"
    );
  }
  if (!rawKey) {
    throw new Error(
      "[RealSheetsService] Missing required env var: GOOGLE_PRIVATE_KEY"
    );
  }

  // .env files store \n as a literal backslash-n; convert to real newlines.
  const privateKey = rawKey.replace(/\\n/g, "\n");

  return { clientEmail, privateKey };
}

// ── Month matching ────────────────────────────────────────────────────────────
// The closingMonth value in the sheet may arrive in many formats.
// This function tries to match against a canonical YYYY-MM target.
// Extend this as the actual format is confirmed.

function rowMatchesMonth(closingMonth: string, targetMonth: string): boolean {
  if (!closingMonth || !targetMonth) return false;

  const [targetYear, targetMonthNum] = targetMonth.split("-");
  if (!targetYear || !targetMonthNum) return false;

  // Normalise: strip leading zeros from month for comparison
  const m = parseInt(targetMonthNum, 10);

  // Pattern 1: ISO "2024-03" or "2024-03-31"
  if (closingMonth.startsWith(`${targetYear}-${targetMonthNum}`)) return true;
  if (closingMonth.startsWith(`${targetYear}-${m}`)) return true;

  // Pattern 2: Japanese "2024年3月" or "2024年03月" or "2024年3月31日"
  if (
    closingMonth.includes(`${targetYear}年`) &&
    (closingMonth.includes(`${m}月`) || closingMonth.includes(`${targetMonthNum}月`))
  ) {
    return true;
  }

  // Pattern 3: Slash "2024/03" or "2024/3"
  if (
    closingMonth.startsWith(`${targetYear}/${targetMonthNum}`) ||
    closingMonth.startsWith(`${targetYear}/${m}`)
  ) {
    return true;
  }

  return false;
}

// ── Empty row detection ───────────────────────────────────────────────────────
// A row is considered empty (and skipped) if the required payerName field
// is blank or whitespace-only.

function isEmptyRow(raw: Record<string, string>): boolean {
  const name = raw["名前"]?.trim() ?? "";
  return name === "";
}

// ── Row normalisation ─────────────────────────────────────────────────────────
// Converts a raw string map (header → value) into a typed InvoiceSubmission.
// Unknown columns are silently ignored.
// Missing mapped columns fall back to "".

function normalizeRow(
  raw: Record<string, string>,
  rowIndex: number
): InvoiceSubmission {
  // Trim all values defensively
  const get = (col: string): string => (raw[col] ?? "").trim();

  return {
    // Row identity
    id:                        `row-${rowIndex}`,
    submissionRowNumber:        rowIndex,

    // Mapped fields
    payerName:                  get("名前"),
    closingMonth:               get("請求書の対象月末(締め日)を選択して下さい"),
    invoiceAttachment:          get("請求書の添付"),
    notes:                      get("その他特記事項（何かあれば記載してください）"),
    internalDepartment:         get("※内部案件の場合のみ 部門を選択して下さい。"),
    externalProjectName:        get("※外部案件の場合のみ 案件名を選択してください。"),
    projectType:                get("請求書の内訳(内部案件or外部案件)"),
    claimedAmountTaxIncluded:   get("請求金額(税込) ※請求通貨で記入"),
    invoiceProjectStatus:       get("請求書の案件を"),
    paymentStatus:              get("支払"),
    paymentAmount:              get("金額"),
    paymentProcessingStatus:    get("支払処理"),
  };
}

// ── RealSheetsService ─────────────────────────────────────────────────────────

export class RealSheetsService implements ISheetsService {
  private readonly config: SheetsConfig;
  private readonly auth: Auth.GoogleAuth;

  constructor() {
    // Load and validate config eagerly so misconfiguration surfaces immediately,
    // not on the first request.
    this.config = loadConfig();
    const creds = loadCredentials();

    this.auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: creds.clientEmail,
        private_key:  creds.privateKey,
      },
      scopes: [
        // Read-only scope — this service never writes to the sheet.
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ],
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Loads all invoice submission rows for the given month.
   *
   * @param month - Target month in "YYYY-MM" format.
   * @returns Normalized InvoiceSubmission array, filtered to the target month.
   *          Empty rows are skipped. Rows without closingMonth are included
   *          and flagged downstream during validation.
   */
  async loadSubmissions(month: string): Promise<InvoiceSubmission[]> {
    const rawRows = await this.fetchSheetRows();

    const submissions: InvoiceSubmission[] = [];

    for (const { raw, rowIndex } of rawRows) {
      // Skip completely empty rows (no payer name)
      if (isEmptyRow(raw)) continue;

      const submission = normalizeRow(raw, rowIndex);

      // Month filter: include rows that match the target month OR have no
      // closingMonth set (treat as needing review, not silently dropped).
      const hasClosingMonth = submission.closingMonth.trim() !== "";
      const matches = !hasClosingMonth || rowMatchesMonth(submission.closingMonth, month);

      if (matches) {
        submissions.push(submission);
      }
    }

    return submissions;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Fetches all rows from the configured sheet range.
   * Returns an array of { raw: Record<string, string>, rowIndex: number }.
   * rowIndex is 1-based and matches the actual spreadsheet row number.
   */
  private async fetchSheetRows(): Promise<
    Array<{ raw: Record<string, string>; rowIndex: number }>
  > {
    const sheetsApi = google.sheets({
      version: "v4",
      auth: await this.auth.getClient() as Auth.OAuth2Client,
    });

    const fullRange = `${this.config.sheetName}!${this.config.range}`;

    const response = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range: fullRange,
      // FORMATTED_VALUE preserves how the user sees the cell (e.g. "2024年3月31日")
      // rather than the underlying serial number for dates.
      valueRenderOption: "FORMATTED_VALUE",
      // Return values as rows (default, explicit for clarity)
      majorDimension: "ROWS",
    });

    const allRows = response.data.values ?? [];

    if (allRows.length === 0) {
      console.warn(`[RealSheetsService] Sheet "${this.config.sheetName}" returned no rows.`);
      return [];
    }

    // headerRow is 1-based; convert to 0-based index within the fetched range.
    const headerIdx = this.config.headerRow - 1;

    if (headerIdx >= allRows.length) {
      throw new Error(
        `[RealSheetsService] GOOGLE_SHEET_HEADER_ROW=${this.config.headerRow} ` +
        `but the sheet only has ${allRows.length} rows in range "${fullRange}".`
      );
    }

    const headers = (allRows[headerIdx] as string[]).map((h) => h?.trim() ?? "");

    // Log unrecognised headers once to help with debugging column name mismatches.
    this.warnUnknownHeaders(headers);

    const result: Array<{ raw: Record<string, string>; rowIndex: number }> = [];

    for (let i = headerIdx + 1; i < allRows.length; i++) {
      const cells = allRows[i] as string[];

      // Map each cell to its header — cells beyond the header width are ignored,
      // headers beyond the cell width default to "".
      const raw: Record<string, string> = {};
      headers.forEach((header, colIdx) => {
        if (header) {
          raw[header] = cells[colIdx]?.trim() ?? "";
        }
      });

      // rowIndex = actual spreadsheet row number (accounting for header offset).
      // If the range starts at A1 and headerRow=1, data starts at row 2.
      const spreadsheetRowNumber = this.config.headerRow + (i - headerIdx);

      result.push({ raw, rowIndex: spreadsheetRowNumber });
    }

    return result;
  }

  /**
   * Logs a warning for any column headers in the sheet that are not in
   * COLUMN_MAP. This helps catch renamed or newly added columns early.
   */
  private warnUnknownHeaders(headers: string[]): void {
    const known = new Set(Object.keys(COLUMN_MAP));
    const unknown = headers.filter((h) => h && !known.has(h));

    if (unknown.length > 0) {
      console.warn(
        "[RealSheetsService] Unrecognised column headers (will be ignored):\n" +
        unknown.map((h) => `  • "${h}"`).join("\n") + "\n" +
        "Add them to COLUMN_MAP in RealSheetsService.ts if they should be mapped."
      );
    }
  }
}
