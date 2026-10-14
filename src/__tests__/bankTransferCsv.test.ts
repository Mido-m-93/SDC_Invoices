import { buildBankTransfer } from "@/lib/bankTransferCsv";
import type { ExpenseClaim } from "@/types";

function claim(over: Partial<ExpenseClaim>): ExpenseClaim {
  return {
    id: "c1", submittedBy: "Aiko Tanaka", submittedByEmail: "aiko@example.com", submittedAt: "2026-10-01T00:00:00Z",
    category: "transport", description: "", expenseReason: "", amount: 1000, currency: "JPY",
    paymentMethod: "personal_reimbursement", receiptUrl: "", receiptFilename: "", projectName: "", internalDepartment: "",
    expenseDate: "2026-10-01", status: "approved", reviewerComment: "", reviewedBy: "", reviewedAt: null,
    approvedBy: "", approvedAt: null, paidAt: null, extractedAmount: null, extractedDate: null, extractedVendor: null,
    policyViolations: [], bankAccount: "Demo Bank 001 / 1234567", createdAt: "", updatedAt: "",
    ...over,
  } as ExpenseClaim;
}

const HEADER = "Recipient,Email,Bank Account,Currency,Amount,Claims,Memo,Note";

describe("buildBankTransfer", () => {
  it("totals each member's approved claims into one row", () => {
    const r = buildBankTransfer(
      [
        claim({ id: "a", amount: 1200 }),
        claim({ id: "b", amount: 800 }),
        claim({ id: "c", submittedBy: "Daniel Okafor", submittedByEmail: "d@example.com", amount: 5000 }),
      ],
      "Expenses 2026-10"
    );
    expect(r.rows.map((x) => [x.recipient, x.amount, x.claimCount])).toEqual([
      ["Aiko Tanaka", 2000, 2],
      ["Daniel Okafor", 5000, 1],
    ]);
    expect(r.totalsByCurrency).toEqual({ JPY: 7000 });
  });

  it("only includes approved, unpaid, non-deleted claims", () => {
    const r = buildBankTransfer(
      [
        claim({ id: "a" }),
        claim({ id: "b", status: "paid", paidAt: "2026-10-02" }),
        claim({ id: "c", status: "submitted" }),
        claim({ id: "d", status: "rejected" }),
        claim({ id: "e", deletedAt: "2026-10-03" }),
      ],
      "m"
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].claimCount).toBe(1);
  });

  it("never adds different currencies together", () => {
    const r = buildBankTransfer(
      [claim({ id: "a", amount: 1000 }), claim({ id: "b", amount: 25.5, currency: "usd" })],
      "m"
    );
    expect(r.rows.map((x) => [x.currency, x.amount])).toEqual([
      ["JPY", 1000],
      ["USD", 25.5],
    ]);
    expect(r.totalsByCurrency).toEqual({ JPY: 1000, USD: 25.5 });
  });

  it("sums decimals without floating-point drift", () => {
    const r = buildBankTransfer(
      [claim({ id: "a", amount: 0.1, currency: "USD" }), claim({ id: "b", amount: 0.2, currency: "USD" })],
      "m"
    );
    expect(r.rows[0].amount).toBe(0.3);
    expect(r.csv).toContain(",USD,0.30,2,");
  });

  it("flags a missing bank account and conflicting accounts", () => {
    const none = buildBankTransfer([claim({ bankAccount: "" })], "m");
    expect(none.rows[0].note).toMatch(/No bank account/);
    const two = buildBankTransfer(
      [claim({ id: "a", bankAccount: "Bank A 1" }), claim({ id: "b", bankAccount: "Bank B 2" })],
      "m"
    );
    expect(two.rows[0].note).toMatch(/2 different bank accounts/);
    const ok = buildBankTransfer([claim({})], "m");
    expect(ok.rows[0].note).toBe("");
  });

  it("uses the newest claim's name and bank account", () => {
    const r = buildBankTransfer(
      [
        claim({ id: "a", submittedAt: "2026-09-01T00:00:00Z", bankAccount: "Old Bank 1" }),
        claim({ id: "b", submittedAt: "2026-10-05T00:00:00Z", bankAccount: "New Bank 2" }),
      ],
      "m"
    );
    expect(r.rows[0].bankAccount).toBe("New Bank 2");
  });

  it("writes a BOM, CRLF lines and a header, and escapes commas, quotes and newlines", () => {
    const r = buildBankTransfer([claim({ submittedBy: 'Lee, "J" Kim', bankAccount: "Bank\n001" })], "m");
    expect(r.csv.startsWith("﻿" + HEADER + "\r\n")).toBe(true);
    expect(r.csv).toContain('"Lee, ""J"" Kim"');
    expect(r.csv).toContain('"Bank\n001"');
    expect(r.csv.endsWith("\r\n")).toBe(true);
  });

  it("neutralises spreadsheet formulas in text cells but keeps amounts numeric", () => {
    const r = buildBankTransfer([claim({ submittedBy: '=HYPERLINK("x")', bankAccount: "+81 3 0000" })], "m");
    expect(r.csv).toContain("'=HYPERLINK");
    expect(r.csv).toContain("'+81 3 0000");
    expect(r.csv).toMatch(/,JPY,1000,1,/);
  });

  it("returns no rows (header only) when nothing is payable", () => {
    const r = buildBankTransfer([claim({ status: "paid", paidAt: "2026-10-02" })], "m");
    expect(r.rows).toEqual([]);
    expect(r.csv).toBe("﻿" + HEADER + "\r\n");
  });
});
