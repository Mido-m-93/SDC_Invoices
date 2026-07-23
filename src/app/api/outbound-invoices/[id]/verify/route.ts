import { NextRequest, NextResponse } from "next/server";
import { getOutboundInvoiceService, getContractService } from "@/lib/services";
import { verifyConsistency } from "@/lib/services/ai/consistencyVerifier";

export const dynamic = 'force-dynamic';

// AI checkpoint: client Invoice ↔ Contract. Compares the invoice against the
// contract it was issued from and flags anything that doesn't line up.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const invoiceSvc = getOutboundInvoiceService();
    const invoice = await invoiceSvc.getInvoice(params.id);
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    if (!invoice.contractId) return NextResponse.json({ error: "Invoice has no linked contract to verify against" }, { status: 400 });

    const contract = await getContractService().listContracts().then(cs => cs.find(c => c.id === invoice.contractId));
    if (!contract) return NextResponse.json({ error: `Contract ${invoice.contractId} not found` }, { status: 404 });

    const verdict = await verifyConsistency("outbound invoice", invoice, "contract", contract);
    const updated = { ...invoice, verification: verdict };
    await invoiceSvc.saveInvoice(updated);

    return NextResponse.json({ success: true, verdict, invoice: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[API ERROR] verify outbound invoice", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
