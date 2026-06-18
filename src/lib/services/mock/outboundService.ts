import type { IOutboundService } from "../types";
import type { OutboundInvoice } from "@/types";

const store = new Map<string, OutboundInvoice>();

export class MockOutboundService implements IOutboundService {
  async listOutbound(filters?: { status?: string }): Promise<OutboundInvoice[]> {
    let list = Array.from(store.values());
    if (filters?.status) list = list.filter((i) => i.status === filters.status);
    return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  async getOutbound(id: string): Promise<OutboundInvoice | null> {
    return store.get(id) ?? null;
  }

  async saveOutbound(invoice: OutboundInvoice): Promise<void> {
    store.set(invoice.id, invoice);
  }

  async deleteOutbound(id: string): Promise<void> {
    store.delete(id);
  }
}
