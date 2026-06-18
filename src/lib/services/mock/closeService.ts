import type { ICloseService } from "../types";
import type { MonthlyChecklistItem, BankSyncStatus } from "@/types";

const store = new Map<string, MonthlyChecklistItem>();

const DEFAULT_ITEMS = [
  { category: "invoices",  title: "All inbound invoices reviewed",          sortOrder: 1 },
  { category: "invoices",  title: "Blocked invoices resolved or escalated", sortOrder: 2 },
  { category: "invoices",  title: "All invoices sent to Money Forward",     sortOrder: 3 },
  { category: "expenses",  title: "All expense claims reviewed",            sortOrder: 4 },
  { category: "expenses",  title: "Missing receipts chased",                sortOrder: 5 },
  { category: "outbound",  title: "Outbound invoices issued to clients",    sortOrder: 6 },
  { category: "outbound",  title: "Unpaid outbound invoices checked",       sortOrder: 7 },
  { category: "bank",      title: "Money Forward bank sync verified",       sortOrder: 8 },
  { category: "bank",      title: "Unresolved bank sync issues cleared",    sortOrder: 9 },
  { category: "tax",       title: "Consumption tax items reviewed",         sortOrder: 10 },
  { category: "payroll",   title: "Payroll items reviewed",                 sortOrder: 11 },
  { category: "reporting", title: "Management summary prepared",            sortOrder: 12 },
];

export class MockCloseService implements ICloseService {
  async getChecklist(month: string): Promise<MonthlyChecklistItem[]> {
    const items = DEFAULT_ITEMS.map((d) => {
      const id = `${month}-${String(d.sortOrder).padStart(2, "0")}`;
      return store.get(id) ?? ({ ...d, id, month, status: "pending" } as MonthlyChecklistItem);
    });
    return items;
  }

  async saveChecklistItem(item: MonthlyChecklistItem): Promise<void> {
    store.set(item.id, item);
  }

  async initChecklist(month: string): Promise<MonthlyChecklistItem[]> {
    return this.getChecklist(month);
  }

  async getBankSyncStatus(): Promise<BankSyncStatus> {
    return { lastSyncAt: null, status: "unknown", message: "Mock mode — bank sync not available", unresolvedCount: 0 };
  }
}
