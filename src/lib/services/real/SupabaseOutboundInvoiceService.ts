import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IOutboundInvoiceService } from "../types";
import type { OutboundInvoice, OutboundInvoiceStatus, OutboundInvoiceSummary } from "@/types";

function toRow(inv: OutboundInvoice): Record<string, unknown> {
  return {
    id: inv.id,
    contract_id: inv.contractId,
    client_id: inv.clientId,
    client_name: inv.clientName,
    project_name: inv.projectName,
    invoice_number: inv.invoiceNumber,
    billing_month: inv.billingMonth,
    issue_date: inv.issueDate,
    due_date: inv.dueDate,
    subtotal: inv.subtotal,
    tax_amount: inv.taxAmount,
    total: inv.total,
    currency: inv.currency,
    status: inv.status,
    notes: inv.notes,
    sent_at: inv.sentAt,
    paid_at: inv.paidAt,
    paid_amount: inv.paidAmount,
    created_by: inv.createdBy,
    approved_by: inv.approvedBy,
    approved_at: inv.approvedAt,
    verification: inv.verification ?? null,
    created_at: inv.createdAt,
    updated_at: inv.updatedAt,
  };
}

function fromRow(row: Record<string, unknown>): OutboundInvoice {
  return {
    id: row.id as string,
    contractId: (row.contract_id as string) ?? "",
    clientId: (row.client_id as string) ?? "",
    clientName: (row.client_name as string) ?? "",
    projectName: (row.project_name as string) ?? "",
    invoiceNumber: (row.invoice_number as string) ?? "",
    billingMonth: (row.billing_month as string) ?? "",
    issueDate: (row.issue_date as string) ?? "",
    dueDate: (row.due_date as string) ?? "",
    subtotal: (row.subtotal as number) ?? 0,
    taxAmount: (row.tax_amount as number) ?? 0,
    total: (row.total as number) ?? 0,
    currency: (row.currency as string) ?? "JPY",
    status: row.status as OutboundInvoiceStatus,
    notes: (row.notes as string) ?? "",
    sentAt: (row.sent_at as string | null) ?? null,
    paidAt: (row.paid_at as string | null) ?? null,
    paidAmount: (row.paid_amount as number | null) ?? null,
    createdBy: (row.created_by as string) ?? "",
    approvedBy: (row.approved_by as string) ?? "",
    approvedAt: (row.approved_at as string | null) ?? null,
    verification: (row.verification as OutboundInvoice["verification"]) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export class SupabaseOutboundInvoiceService implements IOutboundInvoiceService {
  private get db() {
    return getSupabaseClient();
  }

  async listInvoices(filters?: { status?: OutboundInvoiceStatus; billingMonth?: string }): Promise<OutboundInvoice[]> {
    let query = this.db.from("outbound_invoices").select("*").order("created_at", { ascending: false });
    if (filters?.status) query = query.eq("status", filters.status);
    if (filters?.billingMonth) query = query.eq("billing_month", filters.billingMonth);
    const { data, error } = await query;
    if (error) throw new Error(`listInvoices: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async getInvoice(id: string): Promise<OutboundInvoice | null> {
    const { data, error } = await this.db.from("outbound_invoices").select("*").eq("id", id).single();
    if (error) return null;
    return fromRow(data as Record<string, unknown>);
  }

  async saveInvoice(invoice: OutboundInvoice): Promise<void> {
    const { error } = await this.db
      .from("outbound_invoices")
      .upsert(toRow(invoice), { onConflict: "id" });
    if (error) throw new Error(`saveInvoice: ${error.message}`);
  }

  async deleteInvoice(id: string): Promise<void> {
    const { error } = await this.db.from("outbound_invoices").delete().eq("id", id);
    if (error) throw new Error(`deleteInvoice: ${error.message}`);
  }

  async updateStatus(id: string, status: OutboundInvoiceStatus, actorName: string): Promise<void> {
    const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === "sent") updates.sent_at = new Date().toISOString();
    if (status === "paid") updates.paid_at = new Date().toISOString();
    if (status === "pending_approval") {
      updates.approved_by = actorName;
      updates.approved_at = new Date().toISOString();
    }
    const { error } = await this.db.from("outbound_invoices").update(updates).eq("id", id);
    if (error) throw new Error(`updateStatus: ${error.message}`);
  }

  async getSummary(month?: string): Promise<OutboundInvoiceSummary> {
    let query = this.db.from("outbound_invoices").select("status, total, currency");
    if (month) query = query.eq("billing_month", month);
    const { data, error } = await query;
    if (error) throw new Error(`getSummary: ${error.message}`);

    const invoices = (data ?? []) as Array<{ status: string; total: number; currency: string }>;
    const counts = { draft: 0, pending_approval: 0, sent: 0, overdue: 0, paid: 0, cancelled: 0 };
    let totalOutstanding = 0;
    const currency = invoices[0]?.currency ?? "JPY";

    for (const inv of invoices) {
      const s = inv.status as keyof typeof counts;
      if (s in counts) counts[s]++;
      if (inv.status === "sent" || inv.status === "overdue") totalOutstanding += inv.total;
    }

    return {
      total: invoices.length,
      draft: counts.draft,
      pendingApproval: counts.pending_approval,
      sent: counts.sent,
      overdue: counts.overdue,
      paid: counts.paid,
      totalOutstanding,
      currency,
    };
  }
}
