import type { IExpenseService } from "../types";
import type { ExpenseClaim, ExpenseStatus, ExpenseValidationResult } from "@/types";
import {
  loadExpenseClaims,
  saveExpenseClaim,
  deleteExpenseClaim,
  updateExpenseClaimStatus,
} from "./fileStore";

export class MockExpenseService implements IExpenseService {
  async listClaims(filters?: { status?: ExpenseStatus; submittedBy?: string }): Promise<ExpenseClaim[]> {
    let list = loadExpenseClaims();
    if (filters?.status)      list = list.filter((c) => c.status === filters.status);
    if (filters?.submittedBy) list = list.filter((c) => c.submittedBy === filters.submittedBy);
    return list.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  async getClaim(id: string): Promise<ExpenseClaim | null> {
    return loadExpenseClaims().find((c) => c.id === id) ?? null;
  }

  async saveClaim(claim: ExpenseClaim): Promise<void> {
    saveExpenseClaim(claim);
  }

  async deleteClaim(id: string): Promise<void> {
    deleteExpenseClaim(id);
  }

  async updateStatus(id: string, status: ExpenseStatus, actorName: string, comment?: string): Promise<void> {
    updateExpenseClaimStatus(id, status, actorName, comment);
  }

  async validateClaim(claim: ExpenseClaim): Promise<ExpenseValidationResult> {
    const TRANSPORT_NO_RECEIPT = /[→↔]|電車|バス|train|bus|subway|公共交通|metro|路線/i;
    const isNoReceiptTransport =
      claim.category === "transport" && TRANSPORT_NO_RECEIPT.test(claim.description ?? "");

    const violations: string[] = [];
    if (!claim.receiptUrl && !claim.receiptFilename && !isNoReceiptTransport) {
      violations.push("MISSING_RECEIPT");
    }
    if (!claim.description) violations.push("MISSING_PURPOSE");
    if (claim.amount > 100000 && claim.paymentMethod === "personal_reimbursement") {
      violations.push("HIGH_AMOUNT_PERSONAL_REIMBURSEMENT");
    }
    if (claim.amount > 1000000) violations.push("REQUIRES_MANAGEMENT_APPROVAL");

    const receiptMissing = !claim.receiptUrl && !claim.receiptFilename && !isNoReceiptTransport;
    const riskLevel =
      violations.includes("MISSING_RECEIPT") || violations.includes("MISSING_PURPOSE")
        ? "BLOCKED"
        : violations.length > 0
        ? "NEEDS_REVIEW"
        : "OK";

    saveExpenseClaim({ ...claim, policyViolations: violations, updatedAt: new Date().toISOString() });

    return {
      claimId:              claim.id,
      receiptAccessible:    !!claim.receiptUrl,
      amountMatchesReceipt: claim.extractedAmount === null || Math.abs((claim.extractedAmount ?? 0) - claim.amount) <= 1,
      dateFound:            !!claim.expenseDate,
      categoryValid:        true,
      receiptMissing,
      policyViolations:     violations,
      riskLevel,
      statusCode:           claim.status,
      extractedAmount:      claim.extractedAmount,
      extractedDate:        claim.extractedDate,
      extractedVendor:      claim.extractedVendor,
    };
  }

  async listExpenses(filters?: { status?: string; month?: string }): Promise<ExpenseClaim[]> {
    let list = loadExpenseClaims();
    if (filters?.status) list = list.filter((c) => c.status === filters.status);
    if (filters?.month)  list = list.filter((c) => c.submittedAt.startsWith(filters.month!));
    return list.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  async getExpense(id: string): Promise<ExpenseClaim | null> { return this.getClaim(id); }
  async saveExpense(claim: ExpenseClaim): Promise<void> { return this.saveClaim(claim); }
  async deleteExpense(id: string): Promise<void> { return this.deleteClaim(id); }
}
