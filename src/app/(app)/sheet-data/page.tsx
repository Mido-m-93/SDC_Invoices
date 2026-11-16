"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import { useLanguage } from "@/translations";
import { useNotifications } from "@/lib/notifications";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { useTableControls } from "@/lib/hooks/useTableControls";
import { TableFooter } from "@/components/ui/TableControls";

interface SyncedSheet {
  id: string;
  name: string;
  headers: string[];
  rowCount: number;
  syncedAt: string;
}
interface SyncedRow {
  rowNumber: number;
  cells: string[];
}
interface Row extends SyncedRow {
  id: string;
}

const getRowId = (r: Row) => r.id;

export default function SheetDataPage() {
  const { t, language } = useLanguage();
  const { notify } = useNotifications();
  const { isAdmin } = useCurrentUser();

  const [sheets, setSheets] = useState<SyncedSheet[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadSheets = useCallback(async () => {
    try {
      const res = await fetch("/api/sheet-data");
      const data = await res.json() as { sheets?: SyncedSheet[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const list = data.sheets ?? [];
      setSheets(list);
      setActiveId((cur) => (cur && list.some((s) => s.id === cur) ? cur : list[0]?.id ?? null));
    } catch (e) {
      notify("error", `${t("sheet_data_load_failed")}: ${e instanceof Error ? e.message : String(e)}`, "/sheet-data");
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  useEffect(() => { loadSheets(); }, [loadSheets]);

  // Reload rows when the tab changes or after a sync refreshes the sheet.
  const active = sheets.find((s) => s.id === activeId) ?? null;
  const activeSyncedAt = active?.syncedAt;
  useEffect(() => {
    if (!activeId) { setRows([]); return; }
    let cancelled = false;
    fetch(`/api/sheet-data/${activeId}`)
      .then((res) => res.json() as Promise<{ rows?: SyncedRow[]; error?: string }>)
      .then((data) => {
        if (cancelled) return;
        setRows((data.rows ?? []).map((r) => ({ ...r, id: String(r.rowNumber) })));
      })
      .catch(() => { if (!cancelled) notify("error", t("sheet_data_load_failed"), "/sheet-data"); });
    return () => { cancelled = true; };
  }, [activeId, activeSyncedAt, notify, t]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.cells.some((c) => c.toLowerCase().includes(q)));
  }, [rows, search]);

  const table = useTableControls(filtered, getRowId, `${activeId}|${search}`);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/sheet-data/sync", { method: "POST" });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      notify("success", t("sheet_data_sync_done"), "/sheet-data");
      await loadSheets();
    } catch (e) {
      notify("error", `${t("sheet_data_sync_failed")}: ${e instanceof Error ? e.message : String(e)}`, "/sheet-data");
    } finally {
      setSyncing(false);
    }
  }

  const locale = language === "ja" ? "ja-JP" : "en-US";
  const lastSynced = sheets.reduce<string | null>((max, s) => (!max || s.syncedAt > max ? s.syncedAt : max), null);

  return (
    <>
      <PageHeader
        title={t("sheet_data_title")}
        subtitle={t("sheet_data_subtitle")}
        actions={isAdmin ? (
          <Button
            variant="primary"
            loading={syncing}
            onClick={handleSync}
            className="bg-[#1a3d2b] hover:bg-[#1a3d2b]/90 text-white"
          >
            {syncing ? t("sheet_data_syncing") : t("sheet_data_sync")}
          </Button>
        ) : undefined}
      />

      {loading ? (
        <p className="text-sm text-stone-400">{t("loading")}</p>
      ) : sheets.length === 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
          <p className="text-stone-400 text-sm">{t("sheet_data_never_synced")}</p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {sheets.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  s.id === activeId
                    ? "bg-[#1a3d2b] border-[#1a3d2b] text-white"
                    : "bg-white border-stone-200 text-stone-600 hover:border-stone-300"
                }`}
              >
                {s.name}
                <span className="ml-1.5 text-xs opacity-70">{s.rowCount}</span>
              </button>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("sheet_data_search")}
              className="w-full max-w-xs rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30"
            />
            {lastSynced && (
              <p className="text-xs text-stone-400">
                {t("sheet_data_last_synced")}: {new Date(lastSynced).toLocaleString(locale)}
              </p>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-stone-200 px-6 py-12 text-center">
              <p className="text-stone-400 text-sm">{t("sheet_data_empty")}</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-stone-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-xs text-stone-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left whitespace-nowrap">{t("sheet_data_row_col")}</th>
                    {(active?.headers ?? []).map((h, i) => (
                      <th key={i} className="px-4 py-3 text-left whitespace-nowrap">{h || `(${i + 1})`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {table.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-stone-50 align-top">
                      <td className="px-4 py-3 text-xs text-stone-400 font-mono">{r.rowNumber}</td>
                      {(active?.headers ?? []).map((_, i) => (
                        <td key={i} className="px-4 py-3 text-stone-700 max-w-xs whitespace-pre-wrap break-words">
                          {r.cells[i] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <TableFooter controls={table} />
            </div>
          )}
        </>
      )}
    </>
  );
}
