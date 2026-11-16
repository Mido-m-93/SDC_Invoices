jest.mock("server-only", () => ({}));
import { columnLetter } from "@/lib/services/real/sheetSyncSource";

describe("columnLetter", () => {
  it("converts 0-based column indexes to Excel letters", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(51)).toBe("AZ");
    expect(columnLetter(52)).toBe("BA");
    expect(columnLetter(701)).toBe("ZZ");
    expect(columnLetter(702)).toBe("AAA");
  });
});
