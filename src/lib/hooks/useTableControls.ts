"use client";

import { useState, useEffect, useMemo } from "react";
import { paginate, toggleId, toggleAll, pruneSelection, selectionState } from "@/lib/tableControls";

/** Default row id getter for records with an `id` field. */
export const byId = (item: { id: string }) => item.id;

/**
 * Client-side pagination + row selection for a list page.
 * `resetKey` — change it (e.g. `${filter}|${month}`) to jump back to page 1.
 */
export function useTableControls<T>(items: T[], getId: (item: T) => string, resetKey = "") {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  useEffect(() => { setPage(1); }, [resetKey, pageSize]);

  const { rows, page: safePage, totalPages } = paginate(items, page, pageSize);
  const allIds = useMemo(() => items.map(getId), [items, getId]);
  const visibleIds = rows.map(getId);

  // Forget selected rows that disappeared from the data.
  useEffect(() => { setSelected((s) => pruneSelection(s, allIds)); }, [allIds]);

  return {
    rows,
    page: safePage,
    totalPages,
    setPage,
    pageSize,
    setPageSize,
    total: items.length,
    selectedCount: selected.size,
    isSelected: (item: T) => selected.has(getId(item)),
    toggle: (item: T) => setSelected((s) => toggleId(s, getId(item))),
    toggleAllVisible: () => setSelected((s) => toggleAll(s, visibleIds)),
    headerState: selectionState(selected, visibleIds),
    clearSelection: () => setSelected(new Set()),
  };
}

// The row-type-independent part, for shared footer/header components.
export type TableControls = Omit<ReturnType<typeof useTableControls>, "rows" | "isSelected" | "toggle">;
