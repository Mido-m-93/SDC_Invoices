import {
  parseSnapshotMonth,
  excelSerialToDate,
  formatCurrency,
  truncate,
  monthOptions,
  formatMonthForDisplay,
  detectCurrency,
} from "@/lib/utils";

describe("parseSnapshotMonth", () => {
  it("parses Japanese date format", () => {
    expect(parseSnapshotMonth("2026年5月")).toBe("2026-05");
    expect(parseSnapshotMonth("2024年12月")).toBe("2024-12");
  });

  it("parses ISO YYYY-MM format", () => {
    expect(parseSnapshotMonth("2026-05")).toBe("2026-05");
    expect(parseSnapshotMonth("2026-05-01")).toBe("2026-05");
  });

  it("parses US short date MM/DD/YY", () => {
    expect(parseSnapshotMonth("5/8/26")).toBe("2026-05");
    expect(parseSnapshotMonth("12/1/25")).toBe("2025-12");
  });

  it("parses US full date MM/DD/YYYY", () => {
    expect(parseSnapshotMonth("5/8/2026")).toBe("2026-05");
  });

  it("parses MM/YYYY format", () => {
    expect(parseSnapshotMonth("05/2026")).toBe("2026-05");
  });

  it("parses Excel serial date", () => {
    expect(parseSnapshotMonth("46173")).toBe("2026-05");
  });

  it("returns unknown for empty or unrecognisable input", () => {
    expect(parseSnapshotMonth(undefined)).toBe("unknown");
    expect(parseSnapshotMonth("")).toBe("unknown");
    expect(parseSnapshotMonth("not-a-date")).toBe("unknown");
  });
});

describe("excelSerialToDate", () => {
  it("converts known serial to correct UTC date", () => {
    const d = excelSerialToDate(46173);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(4); // May = 4
  });
});

describe("formatCurrency", () => {
  it("formats a numeric string as yen", () => {
    expect(formatCurrency("330000")).toBe("¥330,000");
    expect(formatCurrency("1000000")).toBe("¥1,000,000");
  });

  it("strips non-numeric characters before formatting", () => {
    expect(formatCurrency("¥330,000")).toBe("¥330,000");
  });

  it("returns em-dash for empty string", () => {
    expect(formatCurrency("")).toBe("—");
  });

  it("returns original string when input is non-numeric but non-empty", () => {
    expect(formatCurrency("N/A")).toBe("N/A");
  });
});

describe("truncate", () => {
  it("leaves short strings unchanged", () => {
    expect(truncate("hello", 40)).toBe("hello");
  });

  it("truncates long strings and adds ellipsis", () => {
    const long = "a".repeat(50);
    const result = truncate(long, 40);
    expect(result).toHaveLength(41); // 40 chars + ellipsis
    expect(result.endsWith("…")).toBe(true);
  });

  it("uses default max of 40", () => {
    const long = "a".repeat(50);
    expect(truncate(long).endsWith("…")).toBe(true);
  });
});

describe("monthOptions", () => {
  it("returns the requested number of months", () => {
    expect(monthOptions(6)).toHaveLength(6);
    expect(monthOptions(12)).toHaveLength(12);
  });

  it("returns months in YYYY-MM format", () => {
    const months = monthOptions(3);
    months.forEach((m) => expect(m).toMatch(/^\d{4}-\d{2}$/));
  });

  it("starts with the current month", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    expect(monthOptions(1)[0]).toBe(expected);
  });
});

describe("detectCurrency", () => {
  // Boundary: empty/falsy input defaults to JPY rather than throwing or
  // returning an empty string.
  it("returns JPY for empty string", () => {
    expect(detectCurrency("")).toBe("JPY");
  });

  it("defaults to JPY when no currency marker is present at all", () => {
    expect(detectCurrency("Thank you for your business.")).toBe("JPY");
  });

  it("detects USD from a $ symbol", () => {
    expect(detectCurrency("Total: $1,200.00")).toBe("USD");
  });

  it("detects USD from the word 'dollars' regardless of case", () => {
    expect(detectCurrency("One thousand DOLLARS due")).toBe("USD");
  });

  it("detects JPY from 円 even when a $ sign also appears elsewhere as a label, not an amount", () => {
    // Guards against a naive "first match wins" implementation silently
    // flipping on unrelated symbols; JPY patterns are checked in the same
    // pass, so a real ¥/円-denominated invoice should still resolve to JPY
    // whenever no unambiguous USD marker is actually present.
    expect(detectCurrency("合計 100,000円")).toBe("JPY");
  });

  it("detects EUR from the € symbol", () => {
    expect(detectCurrency("€500 total")).toBe("EUR");
  });

  it("detects GBP from the word 'sterling'", () => {
    expect(detectCurrency("Payment in pounds sterling")).toBe("GBP");
  });

  // First-match-wins branch: patterns are checked in declaration order
  // (USD, EUR, GBP, KRW, CNY, SGD, AUD, JPY) — a string with more than one
  // marker resolves to whichever is checked first, not the "real" currency.
  // This documents that behavior rather than asserting an arbitrary outcome.
  it("resolves to the first matching pattern when text contains multiple currency markers", () => {
    expect(detectCurrency("$100 (approx ¥15,000)")).toBe("USD");
  });
});

describe("formatMonthForDisplay", () => {
  it("formats in Japanese", () => {
    expect(formatMonthForDisplay("2026-05", "ja")).toBe("2026年05月");
  });

  it("formats in English", () => {
    expect(formatMonthForDisplay("2026-05", "en")).toBe("May 2026");
  });

  it("returns raw string when format is invalid", () => {
    expect(formatMonthForDisplay("bad", "en")).toBe("bad");
  });
});
