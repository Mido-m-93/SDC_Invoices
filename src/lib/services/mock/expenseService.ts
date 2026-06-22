import type { IExpenseService } from "../types";
import type { ExpenseClaim, ExpenseStatus, ExpenseValidationResult } from "@/types";

const store = new Map<string, ExpenseClaim>();

export class MockExpenseService implements IExpenseService {
  async listClaims(filters?: { status?: ExpenseStatus; submittedBy?: string }): Promise<ExpenseClaim[]> {
    let list = Array.from(store.values());
    if (filters?.status)      list = list.filter((c) => c.status === filters.status);
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

  async updateStatus(id: string, status: ExpenseStatus, actorName: string, comment?: string): Promise<void> {
    const existing = store.get(id);
    if (!existing) return;
    store.set(id, {
      ...existing,
      status,
      reviewedBy: actorName,
      reviewedAt: new Date().toISOString(),
      reviewerComment: comment ?? existing.reviewerComment,
    });
  }

  async validateClaim(_claim: ExpenseClaim): Promise<ExpenseValidationResult> {
    return {
      claimId: _claim.id,
      receiptAccessible: !!_claim.receiptUrl,
      amountMatchesReceipt: true,
      dateFound: !!_claim.expenseDate,
      categoryValid: true,
      receiptMissing: !_claim.receiptUrl,
      policyViolations: [],
      riskLevel: "OK",
      statusCode: _claim.status,
      extractedAmount: null,
      extractedDate: null,
      extractedVendor: null,
    };
  }
}
