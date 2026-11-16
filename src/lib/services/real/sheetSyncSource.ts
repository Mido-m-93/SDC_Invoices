// src/lib/services/real/sheetSyncSource.ts
// Reads EVERY worksheet of a SharePoint Excel workbook through the Microsoft
// Graph workbook API — no file download, no xlsx parsing. Read-only.
//
// Env:
//   SHEET_SYNC_ITEM_ID    drive-item id of the workbook   (or)
//   SHEET_SYNC_FILE_PATH  path inside the site's default drive, e.g. "Finance/Invoices.xlsx"
//   SHEET_SYNC_SITE_PATH  optional, defaults to the app's shared SharePoint site
// Auth reuses AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET.

import "server-only";
import { DEFAULT_SITE_PATH, getGraphToken, graphGet, resolveSiteId } from "./graphClient";

export interface FetchedSheet {
  name: string;
  position: number;
  headers: string[];
  /** One entry per data row, in sheet order. */
  rows: { rowNumber: number; cells: string[] }[];
}

export interface FetchedWorkbook {
  workbookId: string;
  sheets: FetchedSheet[];
}

const CHUNK_ROWS = 2000; // keeps each Graph response well under its ~5 MB limit

/** 0 → "A", 25 → "Z", 26 → "AA" */
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

function toText(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function workbookBase(siteId: string): { base: string; workbookId: string } {
  const itemId = process.env.SHEET_SYNC_ITEM_ID;
  const filePath = process.env.SHEET_SYNC_FILE_PATH;
  if (itemId) {
    return { base: `/sites/${siteId}/drive/items/${encodeURIComponent(itemId)}`, workbookId: itemId };
  }
  if (filePath) {
    const encoded = filePath.split("/").map(encodeURIComponent).join("/");
    return { base: `/sites/${siteId}/drive/root:/${encoded}:`, workbookId: filePath };
  }
  throw new Error("Set SHEET_SYNC_ITEM_ID or SHEET_SYNC_FILE_PATH to point at the SharePoint workbook");
}

interface UsedRangeInfo {
  rowIndex: number;     // 0-based index of the first used row in the sheet
  columnIndex: number;  // 0-based index of the first used column
  rowCount: number;
  columnCount: number;
}

export async function fetchWorkbookSheets(): Promise<FetchedWorkbook> {
  const token = await getGraphToken();
  const siteId = await resolveSiteId(process.env.SHEET_SYNC_SITE_PATH ?? DEFAULT_SITE_PATH, token);
  const { base, workbookId } = workbookBase(siteId);

  const list = await graphGet<{ value: { id: string; name: string; position: number }[] }>(
    `${base}/workbook/worksheets?$select=id,name,position`,
    token
  );

  const sheets: FetchedSheet[] = [];
  for (const ws of list.value) {
    const sheetBase = `${base}/workbook/worksheets/${encodeURIComponent(ws.id)}`;
    const used = await graphGet<UsedRangeInfo | null>(
      `${sheetBase}/usedRange(valuesOnly=true)?$select=rowIndex,columnIndex,rowCount,columnCount`,
      token
    );

    const empty: FetchedSheet = { name: ws.name, position: ws.position, headers: [], rows: [] };
    if (!used) {
      sheets.push(empty);
      continue;
    }

    // An empty sheet reports a single empty cell.
    if (used.rowCount <= 1 && used.columnCount <= 1) {
      const probe = await graphGet<{ text: unknown[][] }>(
        `${sheetBase}/usedRange(valuesOnly=true)?$select=text`,
        token
      );
      if (!probe.text?.[0]?.[0]) {
        sheets.push(empty);
        continue;
      }
    }

    const firstCol = columnLetter(used.columnIndex);
    const lastCol = columnLetter(used.columnIndex + used.columnCount - 1);
    const firstRow = used.rowIndex + 1; // 1-based
    const lastRow = used.rowIndex + used.rowCount;

    const all: { rowNumber: number; cells: string[] }[] = [];
    for (let start = firstRow; start <= lastRow; start += CHUNK_ROWS) {
      const end = Math.min(start + CHUNK_ROWS - 1, lastRow);
      const address = `${firstCol}${start}:${lastCol}${end}`;
      // `text` is the formatted value staff actually see (dates, currency, ...).
      const chunk = await graphGet<{ text: unknown[][] }>(
        `${sheetBase}/range(address='${address}')?$select=text`,
        token
      );
      chunk.text.forEach((row, i) => all.push({ rowNumber: start + i, cells: row.map(toText) }));
    }

    const [headerRow, ...dataRows] = all;
    sheets.push({
      name: ws.name,
      position: ws.position,
      headers: headerRow?.cells ?? [],
      // Drop fully blank rows, keep real row numbers so write-back can find them later.
      rows: dataRows.filter((r) => r.cells.some((c) => c !== "")),
    });
  }

  return { workbookId, sheets };
}
