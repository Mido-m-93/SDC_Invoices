// src/lib/services/real/SupabaseSheetSyncStore.ts
// Stores the raw SharePoint workbook copy (see migration 054_sheet_sync.sql).

import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { FetchedWorkbook } from "./sheetSyncSource";

export interface SyncedSheet {
  id: string;
  name: string;
  position: number;
  headers: string[];
  rowCount: number;
  syncedAt: string;
}

export interface SyncedRow {
  rowNumber: number;
  cells: string[];
}

const PAGE = 1000;       // Supabase returns at most 1000 rows per request
const INSERT_BATCH = 500;

export async function listSyncedSheets(): Promise<SyncedSheet[]> {
  const { data, error } = await getSupabaseClient()
    .from("sheet_sync_sheets")
    .select("id, sheet_name, position, headers, row_count, synced_at")
    .order("position", { ascending: true });
  if (error) throw new Error(`listSyncedSheets: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.sheet_name as string,
    position: r.position as number,
    headers: (r.headers as string[]) ?? [],
    rowCount: r.row_count as number,
    syncedAt: r.synced_at as string,
  }));
}

export async function getSyncedRows(sheetId: string): Promise<SyncedRow[]> {
  const db = getSupabaseClient();
  const out: SyncedRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("sheet_sync_rows")
      .select("row_number, cells")
      .eq("sheet_id", sheetId)
      .order("row_number", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`getSyncedRows: ${error.message}`);
    const page = data ?? [];
    for (const r of page) out.push({ rowNumber: r.row_number as number, cells: (r.cells as string[]) ?? [] });
    if (page.length < PAGE) break;
  }
  return out;
}

/**
 * Replace the stored copy of a workbook with a fresh fetch. Sheets that no
 * longer exist in the workbook are removed. (supabase-js has no transactions,
 * so a failure part-way leaves that sheet's rows incomplete until the next
 * successful sync — the sheet's synced_at is only bumped after its rows land.)
 */
export async function replaceWorkbook(wb: FetchedWorkbook): Promise<{ sheets: number; rows: number }> {
  const db = getSupabaseClient();
  let totalRows = 0;

  for (const sheet of wb.sheets) {
    const { data: meta, error: metaErr } = await db
      .from("sheet_sync_sheets")
      .upsert(
        {
          workbook_id: wb.workbookId,
          sheet_name: sheet.name,
          position: sheet.position,
          headers: sheet.headers,
        },
        { onConflict: "workbook_id,sheet_name" }
      )
      .select("id")
      .single();
    if (metaErr || !meta) throw new Error(`replaceWorkbook(${sheet.name}): ${metaErr?.message ?? "no id"}`);
    const sheetId = meta.id as string;

    const { error: delErr } = await db.from("sheet_sync_rows").delete().eq("sheet_id", sheetId);
    if (delErr) throw new Error(`replaceWorkbook(${sheet.name}) clear: ${delErr.message}`);

    for (let i = 0; i < sheet.rows.length; i += INSERT_BATCH) {
      const batch = sheet.rows.slice(i, i + INSERT_BATCH).map((r) => ({
        sheet_id: sheetId,
        row_number: r.rowNumber,
        cells: r.cells,
      }));
      const { error: insErr } = await db.from("sheet_sync_rows").insert(batch);
      if (insErr) throw new Error(`replaceWorkbook(${sheet.name}) insert: ${insErr.message}`);
    }

    const { error: doneErr } = await db
      .from("sheet_sync_sheets")
      .update({ row_count: sheet.rows.length, synced_at: new Date().toISOString() })
      .eq("id", sheetId);
    if (doneErr) throw new Error(`replaceWorkbook(${sheet.name}) finalize: ${doneErr.message}`);
    totalRows += sheet.rows.length;
  }

  // Drop sheets that were deleted/renamed in the workbook (rows cascade).
  const keep = wb.sheets.map((s) => s.name);
  const { data: existing, error: exErr } = await db
    .from("sheet_sync_sheets")
    .select("id, sheet_name")
    .eq("workbook_id", wb.workbookId);
  if (exErr) throw new Error(`replaceWorkbook cleanup: ${exErr.message}`);
  const stale = (existing ?? []).filter((s) => !keep.includes(s.sheet_name as string)).map((s) => s.id as string);
  if (stale.length > 0) {
    const { error: rmErr } = await db.from("sheet_sync_sheets").delete().in("id", stale);
    if (rmErr) throw new Error(`replaceWorkbook cleanup: ${rmErr.message}`);
  }

  return { sheets: wb.sheets.length, rows: totalRows };
}
