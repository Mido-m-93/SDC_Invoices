import { NextRequest, NextResponse } from "next/server";
import { getOutboundInvoiceService, getContractService, getBudgetService } from "@/lib/services";
import { verifyConsistency } from "@/lib/services/ai/consistencyVerifier";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = 'force-dynamic';

// AI checkpoint: client Invoice ↔ Budget. Reached by traversing the
// invoice's linked Contract to its budgetId — invoices don't carry their
// own budgetId, since the chain is already fully connected through Contract.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const invoiceSvc = getOutboundInvoiceService();
    const invoice = await invoiceSvc.getInvoice(params.id);
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    if (!invoice.contractId) return NextResponse.json({ error: "Invoice has no linked contract to trace back to a budget" }, { status: 400 });

    const contract = await getContractService().listContracts().then(cs => cs.find(c => c.id === invoice.contractId));
    if (!contract) return NextResponse.json({ error: `Contract ${invoice.contractId} not found` }, { status: 404 });
    if (!contract.budgetId) return NextResponse.json({ error: "Linked contract has no budget to verify against" }, { status: 400 });

    const budget = await getBudgetService().listBudgets().then(bs => bs.find(b => b.id === contract.budgetId));
    if (!budget) return NextResponse.json({ error: `Budget ${contract.budgetId} not found` }, { status: 404 });

    const verdict = await verifyConsistency("outbound invoice", invoice, "budget", budget);
    const updated = { ...invoice, verificationBudget: verdict };
    await invoiceSvc.saveInvoice(updated);

    return NextResponse.json({ success: true, verdict, invoice: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[API ERROR] verify outbound invoice budget", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
