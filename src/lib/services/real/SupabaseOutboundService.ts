import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IOutboundService } from "../types";
import type { OutboundInvoice } from "@/types";

function toRow(inv: OutboundInvoice): Record<string, unknown> {
  return {
    id: inv.id,
    client_name: inv.clientName,
    client_email: inv.clientEmail ?? null,
    project_name: inv.projectName,
    contract_id: inv.contractId ?? null,
    invoice_number: inv.invoiceNumber ?? null,
    amount: inv.amount,
    currency: inv.currency,
    billing_date: inv.billingDate,
    due_date: inv.dueDate,
    status: inv.status,
    notes: inv.notes ?? null,
    drive_file_id: inv.driveFileId ?? null,
    drive_file_url: inv.driveFileUrl ?? null,
    sent_at: inv.sentAt ?? null,
    paid_at: inv.paidAt ?? null,
    paid_amount: inv.paidAmount ?? null,
    created_at: inv.createdAt,
  };
}

function fromRow(row: Record<string, unknown>): OutboundInvoice {
  const amount = (row.amount as number) ?? 0;
  const billingDate = (row.billing_date as string) || "";
  return {
    id: row.id as string,
    clientId: (row.client_id as string) || "",
    clientName: row.client_name as string,
    clientEmail: (row.client_email as string) || undefined,
    projectName: row.project_name as string,
    contractId: (row.contract_id as string) || "",
    invoiceNumber: (row.invoice_number as string) || "",
    billingMonth: (row.billing_month as string) || billingDate,
    issueDate: (row.issue_date as string) || billingDate,
    dueDate: row.due_date as string,
    subtotal: (row.subtotal as number) ?? amount,
    taxAmount: (row.tax_amount as number) ?? 0,
    total: (row.total as number) ?? amount,
    currency: row.currency as string,
    status: row.status as OutboundInvoice["status"],
    notes: (row.notes as string) || "",
    sentAt: (row.sent_at as string) || null,
    paidAt: (row.paid_at as string) || null,
    paidAmount: (row.paid_amount as number) ?? null,
    createdBy: (row.created_by as string) || "",
    approvedBy: (row.approved_by as string) || "",
    approvedAt: (row.approved_at as string) || null,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string) || (row.created_at as string),
    // Compact outbound fields
    amount,
    billingDate,
    driveFileId: (row.drive_file_id as string) || undefined,
    driveFileUrl: (row.drive_file_url as string) || undefined,
  };
}

export class SupabaseOutboundService implements IOutboundService {
  private get db() { return getSupabaseClient(); }

  async listOutbound(filters?: { status?: string }): Promise<OutboundInvoice[]> {
    let query = this.db.from("outbound_invoices").select("*").order("due_date", { ascending: true });
    if (filters?.status) query = query.eq("status", filters.status);
    const { data, error } = await query;
    if (error) throw new Error(`listOutbound: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async getOutbound(id: string): Promise<OutboundInvoice | null> {
    const { data, error } = await this.db.from("outbound_invoices").select("*").eq("id", id).single();
    if (error || !data) return null;
    return fromRow(data as Record<string, unknown>);
  }

  async saveOutbound(invoice: OutboundInvoice): Promise<void> {
    const { error } = await this.db.from("outbound_invoices").upsert(toRow(invoice), { onConflict: "id" });
    if (error) throw new Error(`saveOutbound: ${error.message}`);
  }

  async deleteOutbound(id: string): Promise<void> {
    const { error } = await this.db.from("outbound_invoices").delete().eq("id", id);
    if (error) throw new Error(`deleteOutbound: ${error.message}`);
  }
}
