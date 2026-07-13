import type { IExpenseService } from "../types";
import type { ExpenseClaim, ExpenseStatus, ExpenseValidationResult } from "@/types";

const store = new Map<string, ExpenseClaim>();

export class MockExpenseService implements IExpenseService {
  async listClaims(filters?: { status?: ExpenseStatus; submittedBy?: string }): Promise<ExpenseClaim[]> {
    let list = Array.from(store.values());
    if (filters?.status) list = list.filter((c) => c.status === filters.status);
    if (filters?.submittedBy) list = list.filter((c) => c.submittedBy === filters.submittedBy);
    return list.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  async getClaim(id: string): Promise<ExpenseClaim | null> {
    return store.get(id) ?? null;
  }

  async saveClaim(claim: ExpenseClaim): Promise<void> {
    store.set(claim.id, claim);
  }

  async deleteClaim(id: string): Promise<void> {
    store.delete(id);
  }

  async updateStatus(id: string, status: ExpenseStatus, _actorName: string, comment?: string): Promise<void> {
    const claim = store.get(id);
    if (!claim) return;
    store.set(id, { ...claim, status, reviewerComment: comment ?? claim.reviewerComment });
  }

  async validateClaim(claim: ExpenseClaim): Promise<ExpenseValidationResult> {
    const receiptMissing = !claim.receiptUrl;
    const policyViolations: string[] = [];
    if (!claim.amount || claim.amount <= 0) policyViolations.push("invalid_amount");
    return {
      claimId: claim.id,
      receiptAccessible: !receiptMissing,
      amountMatchesReceipt: true,
      dateFound: !!claim.expenseDate,
      categoryValid: !!claim.category,
      receiptMissing,
      policyViolations,
      riskLevel: policyViolations.length > 0 ? "NEEDS_REVIEW" : "OK",
      statusCode: claim.status,
      extractedAmount: null,
      extractedDate: null,
      extractedVendor: null,
    };
  }

  // Aliases for routes that use the expense-style naming
  async listExpenses(filters?: { status?: string; month?: string }): Promise<ExpenseClaim[]> {
    let list = Array.from(store.values());
    if (filters?.status) list = list.filter((c) => c.status === filters.status);
    if (filters?.month) list = list.filter((c) => c.submittedAt.startsWith(filters.month!));
    return list.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  async getExpense(id: string): Promise<ExpenseClaim | null> {
    return this.getClaim(id);
  }

  async saveExpense(claim: ExpenseClaim): Promise<void> {
    return this.saveClaim(claim);
  }

  async deleteExpense(id: string): Promise<void> {
    return this.deleteClaim(id);
  }
}
