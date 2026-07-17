// src/app/api/dev/sandbox-mf/partners/route.ts
//
// Sandbox stand-in for Money Forward's real `/partners` endpoint. Mirrors the
// request/response shape of MoneyForwardService.findOrCreatePartner() so
// SandboxMoneyForwardService can be tested end-to-end without OAuth
// credentials or touching the production MF account. Every request is
// logged so you can inspect exactly what would be sent to the real API.

import { NextRequest, NextResponse } from "next/server";
import { findSandboxPartnersByName, addSandboxPartner, type SandboxPartner } from "@/lib/services/sandbox/sandboxMfStore";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") ?? "";
  console.log(`[SandboxMF] GET /partners?name=${name}`);

  return NextResponse.json({ partners: findSandboxPartnersByName(name) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  console.log("[SandboxMF] POST /partners", JSON.stringify(body));

  const name = (body as { partner?: { name?: string } })?.partner?.name ?? "Unknown Partner";
  const partner: SandboxPartner = {
    id: `sandbox-partner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
  };
  addSandboxPartner(partner);

  return NextResponse.json({ partner });
}
