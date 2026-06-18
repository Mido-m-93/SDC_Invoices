import type { IExpenseService } from "../types";
import type { ExpenseClaim } from "@/types";

const store = new Map<string, ExpenseClaim>();

export class MockExpenseService implements IExpenseService {
  async listExpenses(filters?: { status?: string; month?: string }): Promise<ExpenseClaim[]> {
    let list = Array.from(store.values());
    if (filters?.status) list = list.filter((c) => c.status === filters.status);
    if (filters?.month)  list = list.filter((c) => c.submittedAt.startsWith(filters.month!));
    return list.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  async getExpense(id: string): Promise<ExpenseClaim | null> {
    return store.get(id) ?? null;
  }

  async saveExpense(claim: ExpenseClaim): Promise<void> {
    store.set(claim.id, claim);
  }

  async deleteExpense(id: string): Promise<void> {
    store.delete(id);
  }
}
