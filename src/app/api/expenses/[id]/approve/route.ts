import { NextRequest, NextResponse } from "next/server";
import { getExpenseService, getMoneyForwardService, getPaymentRecordService } from "@/lib/services";
import { generateId } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { approvedBy?: string; comment?: string; action?: "approve" | "reject" };
  try { body = await req.json(); } catch { body = {}; }
  const status = body.action === "reject" ? "rejected" : "approved";
  try {
    const svc = getExpenseService();
    await svc.updateStatus(params.id, status, body.approvedBy ?? "system", body.comment);

    // Register the reimbursement in Money Forward once approved. Failure here
    // shouldn't block the approval itself — it's just left unsent for retry.
    let moneyForward: { billingId: string; billingUrl: string } | null = null;
    if (status === "approved") {
      const claim = await svc.getClaim(params.id);
      if (claim && !claim.mfBillingId) {
        try {
          moneyForward = await getMoneyForwardService().sendExpenseReimbursement(claim);
          await svc.saveClaim({
            ...claim,
            mfBillingId:  moneyForward.billingId,
            mfBillingUrl: moneyForward.billingUrl,
            mfSentAt:     new Date().toISOString(),
          });

          // Record the pending reimbursement — MF has the claim registered, but
          // actual bank payment isn't confirmed yet, so this starts as "pending"
          // and is flipped to confirmed/reconciled later once it clears.
          try {
            await getPaymentRecordService().savePaymentRecord({
              id: generateId("pay"),
              invoiceId: claim.id,
              contractId: "",
              vendorId: "",
              amount: claim.amount,
              currency: claim.currency,
              paymentDate: claim.expenseDate || new Date().toISOString().slice(0, 10),
              paymentMethod: "Money Forward",
              referenceNumber: moneyForward.billingId,
              status: "pending",
              notes: moneyForward.billingUrl,
              createdAt: new Date().toISOString(),
            });
          } catch (payErr) {
            console.warn("[expenses/approve] Could not create payment record:", payErr);
          }
        } catch (mfErr) {
          console.warn("[expenses/approve] Money Forward send failed:", mfErr);
        }
      }
    }

    return NextResponse.json({ ok: true, status, moneyForward });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
