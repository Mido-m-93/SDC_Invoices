import "server-only";
import { getSupabaseClient } from "@/lib/supabase";
import type { IPaymentRecordService } from "../types";
import type { PaymentRecord, PaymentRecordStatus } from "@/types";

function toRow(r: PaymentRecord): Record<string, unknown> {
  return {
    id: r.id,
    invoice_id: r.invoiceId,
    contract_id: r.contractId,
    vendor_id: r.vendorId,
    amount: r.amount,
    currency: r.currency,
    payment_date: r.paymentDate,
    payment_method: r.paymentMethod,
    reference_number: r.referenceNumber,
    status: r.status,
    confirmed_by: r.confirmedBy ?? null,
    confirmed_at: r.confirmedAt ?? null,
    notes: r.notes ?? null,
    created_at: r.createdAt,
  };
}

function fromRow(row: Record<string, unknown>): PaymentRecord {
  return {
    id: row.id as string,
    invoiceId: row.invoice_id as string,
    contractId: row.contract_id as string,
    vendorId: row.vendor_id as string,
    amount: row.amount as number,
    currency: row.currency as string,
    paymentDate: row.payment_date as string,
    paymentMethod: row.payment_method as string,
    referenceNumber: row.reference_number as string,
    status: row.status as PaymentRecordStatus,
    confirmedBy: row.confirmed_by as string | undefined,
    confirmedAt: row.confirmed_at as string | undefined,
    notes: row.notes as string | undefined,
    createdAt: row.created_at as string,
  };
}

export class SupabasePaymentRecordService implements IPaymentRecordService {
  private get db() {
    return getSupabaseClient();
  }

  async listPaymentRecords(filters?: { invoiceId?: string; contractId?: string; status?: PaymentRecordStatus }): Promise<PaymentRecord[]> {
    let query = this.db.from("payment_records").select("*").order("created_at", { ascending: false });
    if (filters?.invoiceId) query = query.eq("invoice_id", filters.invoiceId);
    if (filters?.contractId) query = query.eq("contract_id", filters.contractId);
    if (filters?.status) query = query.eq("status", filters.status);
    const { data, error } = await query;
    if (error) throw new Error(`listPaymentRecords: ${error.message}`);
    return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
  }

  async savePaymentRecord(record: PaymentRecord): Promise<void> {
    const { error } = await this.db
      .from("payment_records")
      .upsert(toRow(record), { onConflict: "id" });
    if (error) throw new Error(`savePaymentRecord: ${error.message}`);
  }

  async deletePaymentRecord(id: string): Promise<void> {
    const { error } = await this.db.from("payment_records").delete().eq("id", id);
    if (error) throw new Error(`deletePaymentRecord: ${error.message}`);
  }
}
