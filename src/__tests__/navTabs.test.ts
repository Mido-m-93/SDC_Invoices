import { isValidTabSelection } from "@/lib/navTabs";

describe("isValidTabSelection", () => {
  it("accepts null (unrestricted) and lists of known tabs, including none", () => {
    expect(isValidTabSelection(null)).toBe(true);
    expect(isValidTabSelection(["/invoices", "/expenses"])).toBe(true);
    expect(isValidTabSelection([])).toBe(true);
  });

  it("rejects unknown tabs, non-arrays and a missing value", () => {
    expect(isValidTabSelection(["/users"])).toBe(false);
    expect(isValidTabSelection("/invoices")).toBe(false);
    expect(isValidTabSelection(undefined)).toBe(false);
    expect(isValidTabSelection([1])).toBe(false);
  });
});

describe("grant-only tabs (Sheet Data)", () => {
  const { canSeeTab, tabsToStore, REGULAR_TABS, MANAGEABLE_TABS } = jest.requireActual("@/lib/navTabs") as typeof import("@/lib/navTabs");

  it("is visible to admins, hidden from unrestricted Members, visible once explicitly granted", () => {
    expect(canSeeTab("/sheet-data", null, true)).toBe(true);
    expect(canSeeTab("/sheet-data", null, false)).toBe(false);
    expect(canSeeTab("/sheet-data", ["/invoices"], false)).toBe(false);
    expect(canSeeTab("/sheet-data", ["/sheet-data"], false)).toBe(true);
  });

  it("leaves regular tabs behaving as before", () => {
    expect(canSeeTab("/invoices", null, false)).toBe(true);
    expect(canSeeTab("/invoices", ["/expenses"], false)).toBe(false);
  });

  it("accepts the grant-only tab as a valid selection", () => {
    expect(isValidTabSelection(["/sheet-data"])).toBe(true);
  });

  it("tabsToStore: all regular tabs and no grant -> null; any grant -> explicit list", () => {
    const allRegular = new Set(REGULAR_TABS.map((t) => t.href));
    expect(tabsToStore(allRegular)).toBeNull();
    const withGrant = new Set([...Array.from(allRegular), "/sheet-data"]);
    const stored = tabsToStore(withGrant);
    expect(stored).not.toBeNull();
    expect(stored).toContain("/sheet-data");
    expect(tabsToStore(new Set(["/invoices"]))).toEqual(["/invoices"]);
    expect(MANAGEABLE_TABS.some((t) => t.grantOnly)).toBe(true);
  });
});
