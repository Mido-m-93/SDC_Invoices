// lib/services/cashVerificationService.ts — final checkpoint of the
// Proposal -> Budget -> Contract -> Invoice -> Cash chain: does the invoice
// match the cash actually received?
//
// Unlike every other checkpoint (manual "Verify" button), this one is meant
// to run automatically whenever a PaymentRecord gets linked to an invoice —
// per the agreed design, no missing-invoice aging/cron check, just the
// amount-match itself, and only when there's something to compare against.

import "server-only";
import { getOutboundInvoiceService, getPaymentRecordService } from "@/lib/services";
import { verifyConsistency } from "@/lib/services/ai/consistencyVerifier";
import type { ConsistencyVerdict, PaymentRecord, OutboundInvoice } from "@/types";

/**
 * Runs the Invoice ↔ Cash check for a given invoice against its most
 * recent linked payment record. Throws if the invoice or a linked payment
 * record can't be found — callers that want best-effort behavior should
 * use tryAutoVerifyInvoiceCash instead.
 */
export async function verifyInvoiceCash(invoiceId: string): Promise<{ verdict: ConsistencyVerdict; invoice: OutboundInvoice }> {
  const invoiceSvc = getOutboundInvoiceService();
  const invoice = await invoiceSvc.getInvoice(invoiceId);
  if (!invoice) throw new Error("Invoice not found");

  const records = await getPaymentRecordService().listPaymentRecords({ invoiceId });
  const latest = records.sort((a, b) => (a.paymentDate < b.paymentDate ? 1 : -1))[0];
  if (!latest) throw new Error("No linked payment record to verify against");

  const verdict = await verifyConsistency("outbound invoice", invoice, "payment record", latest);
  const updated = { ...invoice, verificationCash: verdict };
  await invoiceSvc.saveInvoice(updated);

  return { verdict, invoice: updated };
}

/**
 * Best-effort auto-check, called right after a PaymentRecord is saved.
 * Silently does nothing if the record isn't linked to an invoice, the
 * invoice can't be found, or the AI check fails — the payment record save
 * itself must never fail because of this.
 */
export async function tryAutoVerifyInvoiceCash(record: PaymentRecord): Promise<void> {
  if (!record.invoiceId) return;
  try {
    await verifyInvoiceCash(record.invoiceId);
  } catch (err) {
    console.warn(`[cashVerificationService] Auto-verify failed for invoice ${record.invoiceId}:`, err);
  }
}
