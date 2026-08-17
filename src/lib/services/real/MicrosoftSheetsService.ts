// src/lib/services/real/MicrosoftSheetsService.ts
// Reads Microsoft Forms responses from a SharePoint/OneDrive Excel file
// via Microsoft Graph API using client credentials (app-only auth).

import "server-only";
import * as XLSX from "xlsx";
import type { ISheetsService } from "../types";
import type { InvoiceSubmission } from "@/types";
import { generateId, excelSerialToDate } from "@/lib/utils";
import { type FieldName, buildFieldMap } from "../formFieldMapping";

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

// Convert an Excel serial number string to a readable value.
// Dates (no fractional part): "2026年5月14日"  → used for closingMonth
// Datetimes (with fractional): ISO string       → used for submittedAt
function convertSerial(raw: string, mode: "date" | "datetime"): string {
  const num = Number(raw);
  if (isNaN(num) || num < 40000 || num > 60000) return raw;
  const d = excelSerialToDate(mode === "date" ? Math.floor(num) : num);
  if (mode === "datetime") {
    // Microsoft Forms Excel export stores "Start time" as JST local time (UTC+9).
    // Subtract 9 h so the resulting ISO string represents the correct UTC instant.
    return new Date(d.getTime() - 9 * 60 * 60 * 1000).toISOString();
  }
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

function normalizeRow(
  raw: Record<string, string>,
  fieldMap: Map<string, FieldName>,
  rowIndex: number
): InvoiceSubmission {
  const get = (key: FieldName): string => {
    for (const [header, field] of Array.from(fieldMap)) {
      if (field !== key) continue;
      const val = (raw[header] ?? "").toString().trim();
      if (val) return val;
    }
    return "";
  };

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
    currency:                   get("currency") || undefined,
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

    // Download the raw file to bypass Graph API Excel caching. SharePoint
    // Online occasionally returns a transient 502/503/504 ("something went
    // wrong, try again in a few minutes") — retry those a few times before
    // giving up, since a client-error (4xx) retrying won't help.
    const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${ITEM_ID}/content`;
    const RETRYABLE_STATUSES = new Set([502, 503, 504]);
    const MAX_ATTEMPTS = 3;

    let res: Response | undefined;
    let lastErrorBody = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (res.ok) break;
      if (!RETRYABLE_STATUSES.has(res.status) || attempt === MAX_ATTEMPTS) {
        lastErrorBody = await res.text();
        break;
      }
      console.warn(`[MicrosoftSheetsService] Excel download got ${res.status}, retrying (attempt ${attempt}/${MAX_ATTEMPTS})...`);
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
    if (!res || !res.ok) {
      throw new Error(`Failed to download Excel file (${res?.status}): ${lastErrorBody}`);
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
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    console.log("[MicrosoftSheetsService] headers:", headers);
    const fieldMap = buildFieldMap(headers);
    console.log("[MicrosoftSheetsService] fieldMap:", JSON.stringify(Object.fromEntries(fieldMap)));

    return rows
      .filter((row) => Object.values(row).some((v) => v !== ""))
      .map((row, i) => normalizeRow(row, fieldMap, i));
  }
}
