// Pure helpers behind the shared table pagination + row selection.

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  return {
    rows: items.slice((safePage - 1) * pageSize, safePage * pageSize),
    page: safePage,
    totalPages,
  };
}

// Page buttons to render: first, last, and current ±1, with "…" for skipped ranges.
export function pageNumbers(totalPages: number, current: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const shown = [...new Set([1, current - 1, current, current + 1, totalPages])]
    .filter((n) => n >= 1 && n <= totalPages)
    .sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  shown.forEach((n, i) => {
    if (i > 0 && n - shown[i - 1] > 1) out.push("…");
    out.push(n);
  });
  return out;
}

export function toggleId(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// Header checkbox: if every visible row is selected, clear them; otherwise select them all.
// Selections on other pages are kept.
export function toggleAll(selected: Set<string>, visibleIds: string[]): Set<string> {
  const next = new Set(selected);
  if (selectionState(selected, visibleIds) === "all") visibleIds.forEach((id) => next.delete(id));
  else visibleIds.forEach((id) => next.add(id));
  return next;
}

// Drop selected ids that are no longer in the data (deleted, filtered out by a refetch, etc.).
export function pruneSelection(selected: Set<string>, validIds: string[]): Set<string> {
  const valid = new Set(validIds);
  if ([...selected].every((id) => valid.has(id))) return selected;
  return new Set([...selected].filter((id) => valid.has(id)));
}

export function selectionState(selected: Set<string>, visibleIds: string[]): "none" | "some" | "all" {
  const count = visibleIds.filter((id) => selected.has(id)).length;
  if (count === 0) return "none";
  return count === visibleIds.length ? "all" : "some";
}
