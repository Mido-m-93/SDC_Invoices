import {
  paginate,
  toggleId,
  toggleAll,
  pruneSelection,
  selectionState,
  pageNumbers,
} from "@/lib/tableControls";

describe("pageNumbers", () => {
  it("lists every page when there are 7 or fewer", () => {
    expect(pageNumbers(5, 3)).toEqual([1, 2, 3, 4, 5]);
  });

  it("collapses the middle with gaps around the current page", () => {
    expect(pageNumbers(20, 10)).toEqual([1, "…", 9, 10, 11, "…", 20]);
  });

  it("does not add a gap next to the first or last page", () => {
    expect(pageNumbers(20, 2)).toEqual([1, 2, 3, "…", 20]);
    expect(pageNumbers(20, 19)).toEqual([1, "…", 18, 19, 20]);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 23 }, (_, i) => i + 1);

  it("returns the requested page slice", () => {
    expect(paginate(items, 2, 10)).toEqual({
      rows: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      page: 2,
      totalPages: 3,
    });
  });

  it("clamps a page past the end to the last page", () => {
    const r = paginate(items, 9, 10);
    expect(r.page).toBe(3);
    expect(r.rows).toEqual([21, 22, 23]);
  });

  it("clamps a page below 1 to the first page", () => {
    expect(paginate(items, 0, 10).page).toBe(1);
  });

  it("treats an empty list as one empty page", () => {
    expect(paginate([], 1, 10)).toEqual({ rows: [], page: 1, totalPages: 1 });
  });
});

describe("selection", () => {
  it("toggleId adds then removes an id without mutating", () => {
    const empty = new Set<string>();
    const one = toggleId(empty, "a");
    expect([...one]).toEqual(["a"]);
    expect(empty.size).toBe(0);
    expect(toggleId(one, "a").size).toBe(0);
  });

  it("toggleAll selects every visible id when not all are selected", () => {
    const s = toggleAll(new Set(["a", "z"]), ["a", "b"]);
    expect([...s].sort()).toEqual(["a", "b", "z"]);
  });

  it("toggleAll deselects only the visible ids when all are selected", () => {
    const s = toggleAll(new Set(["a", "b", "z"]), ["a", "b"]);
    expect([...s]).toEqual(["z"]);
  });

  it("pruneSelection drops ids no longer present", () => {
    expect([...pruneSelection(new Set(["a", "gone"]), ["a", "b"])]).toEqual(["a"]);
  });

  it("pruneSelection returns the same set when nothing changed", () => {
    const s = new Set(["a"]);
    expect(pruneSelection(s, ["a", "b"])).toBe(s);
  });

  it("selectionState reports none / some / all for the visible ids", () => {
    expect(selectionState(new Set(), ["a", "b"])).toBe("none");
    expect(selectionState(new Set(["a"]), ["a", "b"])).toBe("some");
    expect(selectionState(new Set(["a", "b"]), ["a", "b"])).toBe("all");
    expect(selectionState(new Set(["a"]), [])).toBe("none");
  });
});
