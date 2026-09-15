import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { verifyInvoiceCash } from "@/lib/services/cashVerificationService";

export const dynamic = 'force-dynamic';

// AI checkpoint: client Invoice ↔ Cash. Compares the invoice against its
// most recent linked payment record. Runs automatically whenever a payment
// record is linked (see cashVerificationService.tryAutoVerifyInvoiceCash) —
// this route is the manual re-run, same as every other checkpoint's button.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const { verdict, invoice } = await verifyInvoiceCash(params.id);
    return NextResponse.json({ success: true, verdict, invoice });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[API ERROR] verify invoice cash", message);
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}
