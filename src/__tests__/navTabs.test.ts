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
