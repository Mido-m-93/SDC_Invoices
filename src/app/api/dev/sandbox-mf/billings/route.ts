// src/app/api/dev/sandbox-mf/billings/route.ts
//
// Sandbox stand-in for Money Forward's real `/billings` endpoint. Mirrors the
// request/response shape of MoneyForwardService.createBilling() so
// SandboxMoneyForwardService can be tested end-to-end without OAuth
// credentials or touching the production MF account. Every request is
// logged so you can inspect exactly what would be sent to the real API.

import { NextRequest, NextResponse } from "next/server";
import { addSandboxBilling, listSandboxBillings } from "@/lib/services/sandbox/sandboxMfStore";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  console.log("[SandboxMF] POST /billings", JSON.stringify(body, null, 2));

  const id = `sandbox-bill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  addSandboxBilling({ id, request: body, createdAt: new Date().toISOString() });

  const origin = req.nextUrl.origin;
  return NextResponse.json({
    billing: {
      id,
      web_url: `${origin}/api/dev/sandbox-mf/billings/${id}`,
    },
  });
}

export async function GET() {
  return NextResponse.json({ billings: listSandboxBillings() });
}
