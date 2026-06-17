// src/lib/services/real/MicrosoftSheetsService.ts
// Reads Microsoft Forms responses from a SharePoint/OneDrive Excel file
// via Microsoft Graph API using client credentials (app-only auth).

import "server-only";
import * as XLSX from "xlsx";
import type { ISheetsService } from "../types";
import type { InvoiceSubmission } from "@/types";
import { generateId, excelSerialToDate } from "@/lib/utils";

const TENANT_ID     = process.env.AZURE_TENANT_ID!;
const CLIENT_ID     = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;

// ── Get access token using client credentials (app-only auth) ─────────────────
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

async function graphGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph API ${path} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

// ── Column mapping: Microsoft Forms → InvoiceSubmission ──────────────────────
// Keys are normalized (trimmed, \r\n→space, collapsed spaces) before matching.
const COLUMN_MAP: Record<string, keyof InvoiceSubmission | "email"> = {
  "Start time":                                               "submittedAt",
  "Name1":                                                    "payerName",
  "メールアドレス（Email Address）":                          "email",
  "Name":                                                     "payerName",
  "Email":                                                    "email",
  "名前（Name）":                                             "payerName",
  "請求金額(税込)　※請求通貨で記入 Invoice Amount(local currency)": "claimedAmountTaxIncluded",
  "請求金額(税込)　※請求通貨で記入":                          "claimedAmountTaxIncluded",
  "請求書の稼働月 Which month does this invoice cover?":       "closingMonth",
  "請求書の稼働月":                                           "closingMonth",
  "請求書の内訳(内部案件or外部案件) Invoice Category (Internal Project or External Project)": "projectType",
  "請求書の内訳(内部案件or外部案件)":                         "projectType",
  "※内部案件の場合のみ部門を選択して下さい。( For Internal Projects Only)": "internalDepartment",
  "※外部案件の場合のみ案件名を選択してください。 For External Projects Only: Please select the project name.": "externalProjectName",
  "※外部案件の場合のみ案件名を選択してください。":            "externalProjectName",
  "請求書の添付( Invoice Attachment)*PDF形式にて1つの請求書のみアップロードしてください Please upload only one invoice in PDF format. You may upload up to 10 supported files (PDF). Upload up to 10 supported files: PDF. Max 10 MB per": "invoiceAttachment",
  "請求書の添付( Invoice Attachment)":                        "invoiceAttachment",
  "請求書ファイル添付（Attach Invoice File）":                "invoiceAttachment",
  "その他特記事項（何かあれば記載してください） Additional Notes (if any)": "notes",
  "備考（Remarks / Notes）":                                  "notes",
};

function normalizeHeader(h: string): string {
  return h.replace(/\r\n/g, " ").replace(/\s+/g, " ").trim();
}

// Convert an Excel serial number string to a readable value.
// Dates (no fractional part): "2026年5月14日"  → used for closingMonth
// Datetimes (with fractional): ISO string       → used for submittedAt
function convertSerial(raw: string, mode: "date" | "datetime"): string {
  const num = Number(raw);
  if (isNaN(num) || num < 40000 || num > 60000) return raw;
  const d = excelSerialToDate(mode === "date" ? Math.floor(num) : num);
  if (mode === "datetime") return d.toISOString();
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

function normalizeRow(
  raw: Record<string, string>,
  rowIndex: number
): InvoiceSubmission {
  // Normalize the raw row keys so they match COLUMN_MAP
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    normalized[normalizeHeader(k)] = (v ?? "").toString().trim();
  }

  const get = (key: keyof InvoiceSubmission | "email") =>
    Object.entries(COLUMN_MAP)
      .filter(([, v]) => v === key)
      // Normalize the COLUMN_MAP key the same way we normalized the Excel headers
      // so ideographic spaces (U+3000) and other Unicode whitespace don't cause mismatches
      .map(([k]) => normalized[normalizeHeader(k)] ?? "")
      .find((v) => v !== "") ?? "";

  return {
    id: generateId(),
    submissionRowNumber: rowIndex + 2,
    submittedAt:                convertSerial(get("submittedAt"), "datetime") || undefined,
    email:                      get("email"),
    payerName:                  get("payerName"),
    closingMonth:               convertSerial(get("closingMonth"), "date"),
    invoiceAttachment:          get("invoiceAttachment"),
    notes:                      get("notes"),
    internalDepartment:         get("internalDepartment"),
    externalProjectName:        get("externalProjectName"),
    projectType:                get("projectType"),
    claimedAmountTaxIncluded:   get("claimedAmountTaxIncluded"),
    invoiceProjectStatus:       "",
    paymentStatus:              "",
    paymentAmount:              "",
    paymentProcessingStatus:    "",
  };
}

const OWNER_UPN = process.env.MICROSOFT_OWNER_UPN!; // e.g. mohamada@roboco-op.org
const ITEM_ID   = process.env.MICROSOFT_EXCEL_ITEM_ID!; // GUID from sourcedoc param

export class MicrosoftSheetsService implements ISheetsService {
  async loadSubmissions(_month: string): Promise<InvoiceSubmission[]> {
    const token = await getAccessToken();

    const driveInfo = await graphGet<{ id: string }>(
      `/users/${OWNER_UPN}/drive`,
      token
    );
    const driveId = driveInfo.id;

    // Download the raw file to bypass Graph API Excel caching
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${ITEM_ID}/content`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to download Excel file (${res.status}): ${body}`);
    }

    const buffer = await res.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });

    // Use the first sheet that has data
    const sheetName = workbook.SheetNames[0];
    console.log("[MicrosoftSheetsService] sheets:", workbook.SheetNames, "reading:", sheetName);

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: "",
      raw: false,
    });

    console.log("[MicrosoftSheetsService] rows found:", rows.length);
    if (rows.length > 0) console.log("[MicrosoftSheetsService] headers:", Object.keys(rows[0]));

    return rows
      .filter((row) => Object.values(row).some((v) => v !== ""))
      .map((row, i) => normalizeRow(row, i));
  }
}
