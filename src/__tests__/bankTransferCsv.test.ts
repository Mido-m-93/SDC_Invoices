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

const HEADER =
  "Recipient,Email,Bank Account,Currency,Amount,Claims,Transportation Fee Reason,Expense Reason,Submitted,Expense Date,Attachment,Status,Paid Date,Memo,Note";

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

  describe("includePaid option", () => {
    const paid = (over: Partial<ExpenseClaim>) => claim({ status: "paid", paidAt: "2026-10-02T00:00:00Z", ...over });

    it("excludes paid claims by default", () => {
      expect(buildBankTransfer([paid({ id: "a" })], "m").rows).toEqual([]);
    });

    it("includes paid claims when asked, and still excludes submitted / rejected / deleted", () => {
      const r = buildBankTransfer(
        [paid({ id: "a" }), claim({ id: "b", status: "submitted" }), claim({ id: "c", status: "rejected" }), paid({ id: "d", deletedAt: "2026-10-03" })],
        "m",
        { includePaid: true }
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].claimCount).toBe(1);
    });

    it("warns not to pay again when every claim in a row is already paid", () => {
      const r = buildBankTransfer([paid({ id: "a" }), paid({ id: "b", amount: 500 })], "m", { includePaid: true });
      expect(r.rows[0].amount).toBe(1500);
      expect(r.rows[0].note).toMatch(/Already marked paid: do not pay again/);
    });

    it("says how many claims were already paid when a row mixes paid and unpaid", () => {
      const r = buildBankTransfer([paid({ id: "a" }), claim({ id: "b", amount: 500 })], "m", { includePaid: true });
      expect(r.rows[0].amount).toBe(1500);
      expect(r.rows[0].note).toMatch(/1 of 2 claims already marked paid/);
    });

    it("adds no paid warning when nothing in the row is paid", () => {
      const r = buildBankTransfer([claim({ id: "a" })], "m", { includePaid: true });
      expect(r.rows[0].note).toBe("");
    });
  });

  describe("claim detail columns", () => {
    it("adds the claim columns, newest claim first, joined with ' | ' so they line up", () => {
      const r = buildBankTransfer(
        [
          claim({ id: "a", submittedAt: "2026-09-04T07:01:00Z", description: "From Ama till Shimane", expenseReason: "Fare to Okikisen", expenseDate: "2026-08-30", receiptUrl: "https://x.test/a" }),
          claim({ id: "b", submittedAt: "2026-09-05T07:01:00Z", description: "To Ama from Shimane", expenseReason: "Fare", expenseDate: "2026-08-28", receiptUrl: "https://x.test/b" }),
        ],
        "m"
      );
      const row = r.rows[0];
      expect(row.feeReason).toBe("To Ama from Shimane | From Ama till Shimane");
      expect(row.expenseReason).toBe("Fare | Fare to Okikisen");
      expect(row.submitted).toBe("2026-09-05 | 2026-09-04");
      expect(row.expenseDate).toBe("2026-08-28 | 2026-08-30");
      expect(row.attachment).toBe("https://x.test/b | https://x.test/a");
      expect(r.csv).toContain("To Ama from Shimane | From Ama till Shimane,Fare | Fare to Okikisen,2026-09-05 | 2026-09-04");
    });

    it("keeps positions when one claim has an empty value, and leaves a column blank when all are empty", () => {
      const r = buildBankTransfer(
        [
          claim({ id: "a", submittedAt: "2026-09-04T00:00:00Z", description: "Taxi", expenseReason: "" }),
          claim({ id: "b", submittedAt: "2026-09-05T00:00:00Z", description: "", expenseReason: "" }),
        ],
        "m"
      );
      expect(r.rows[0].feeReason).toBe(" | Taxi");
      expect(r.rows[0].expenseReason).toBe("");
    });

    it("shows a single status when all claims share it, otherwise one per claim", () => {
      const same = buildBankTransfer([claim({ id: "a" }), claim({ id: "b" })], "m");
      expect(same.rows[0].status).toBe("approved");
      const mixed = buildBankTransfer(
        [
          claim({ id: "a", submittedAt: "2026-09-04T00:00:00Z" }),
          claim({ id: "b", submittedAt: "2026-09-05T00:00:00Z", status: "paid", paidAt: "2026-10-01" }),
        ],
        "m",
        { includePaid: true }
      );
      expect(mixed.rows[0].status).toBe("paid | approved");
    });

    it("escapes commas in claim text and neutralises formulas", () => {
      const r = buildBankTransfer([claim({ description: "Taxi, airport", expenseReason: "=SUM(A1)" })], "m");
      expect(r.csv).toContain('"Taxi, airport"');
      expect(r.csv).toContain("'=SUM(A1)");
    });
  });

  describe("paid date column", () => {
    it("is blank for unpaid claims and lists each paid claim's date (newest first)", () => {
      const unpaid = buildBankTransfer([claim({})], "m");
      expect(unpaid.rows[0].paidDate).toBe("");
      const r = buildBankTransfer(
        [
          claim({ id: "a", submittedAt: "2026-09-04T00:00:00Z", status: "paid", paidAt: "2026-09-10T08:00:00Z" }),
          claim({ id: "b", submittedAt: "2026-09-05T00:00:00Z", status: "paid", paidAt: "2026-09-12T08:00:00Z" }),
        ],
        "m",
        { includePaid: true }
      );
      expect(r.rows[0].paidDate).toBe("2026-09-12 | 2026-09-10");
      expect(r.csv).toContain(",paid,2026-09-12 | 2026-09-10,");
    });
  });
});
