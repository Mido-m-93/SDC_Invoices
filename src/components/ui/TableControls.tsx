"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useLanguage } from "@/translations";
import { PAGE_SIZE_OPTIONS, pageNumbers } from "@/lib/tableControls";
import type { TableControls } from "@/lib/hooks/useTableControls";

const checkboxClass =
  "h-3.5 w-3.5 rounded border-stone-300 text-emerald-500 accent-emerald-500 cursor-pointer align-middle";

/** Header checkbox: selects / clears every row on the current page. */
export function SelectAllCheckbox({ controls }: { controls: TableControls }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = controls.headerState === "some";
  }, [controls.headerState]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={t("table_select_all")}
      className={checkboxClass}
      checked={controls.headerState === "all"}
      onChange={controls.toggleAllVisible}
    />
  );
}

/** Per-row checkbox. Clicks don't bubble, so clickable rows don't open their detail panel. */
export function RowCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  const { t } = useLanguage();
  return (
    <input
      type="checkbox"
      aria-label={t("table_select_row")}
      className={checkboxClass}
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Footer: optional summary, selected count, rows-per-page dropdown, page buttons. */
export function TableFooter({ controls, children }: { controls: TableControls; children?: ReactNode }) {
  const { t } = useLanguage();
  const { page, totalPages, setPage, pageSize, setPageSize, selectedCount, clearSelection } = controls;
  const navClass =
    "px-2 py-1 rounded text-xs font-medium text-stone-600 hover:bg-stone-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors";

  return (
    <div className="px-4 py-3 border-t border-stone-100 bg-stone-50 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-center gap-4">
        {children}
        {selectedCount > 0 && (
          <span className="text-xs font-medium text-emerald-700">
            {selectedCount} {t("table_selected")}
            <button onClick={clearSelection} className="ml-2 text-stone-400 hover:text-stone-600 underline">
              {t("table_clear_selection")}
            </button>
          </span>
        )}
        <label className="flex items-center gap-1.5 text-xs text-stone-500">
          {t("table_rows_per_page")}
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded border border-stone-200 bg-white px-1.5 py-0.5 text-xs text-stone-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(page - 1)} disabled={page === 1} className={navClass}>
            {t("invoices_prev")}
          </button>
          {pageNumbers(totalPages, page).map((n, i) =>
            n === "…" ? (
              <span key={`gap-${i}`} className="w-7 text-center text-xs text-stone-400">…</span>
            ) : (
              <button
                key={n}
                onClick={() => setPage(n)}
                className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                  n === page ? "bg-emerald-500 text-white shadow-sm" : "text-stone-500 hover:bg-stone-200"
                }`}
              >
                {n}
              </button>
            )
          )}
          <button onClick={() => setPage(page + 1)} disabled={page === totalPages} className={navClass}>
            {t("invoices_next")}
          </button>
        </div>
      )}
    </div>
  );
}
