// src/app/api/dev/sandbox-mf/billings/[id]/route.ts
//
// Lets you open the "billingUrl" returned by SandboxMoneyForwardService in a
// browser tab and see exactly what payload was captured for that billing —
// the same thing the 💴 "View in MF" link does for the real integration.

import { NextResponse } from "next/server";
import { getSandboxBillingById } from "@/lib/services/sandbox/sandboxMfStore";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const billing = getSandboxBillingById(params.id);
  if (!billing) {
    return NextResponse.json(
      { error: "Not found — this billing wasn't captured by the sandbox store.", billingId: params.id },
      { status: 404 }
    );
  }
  return NextResponse.json({
    note: "This is the sandbox Money Forward endpoint (not real MF) — showing the captured request payload.",
    billing,
  });
}
