export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getClientService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";
import type { Client } from "@/types";

export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") as Client["status"] | null;
    const clients = await getClientService().listClients(status ? { status } : undefined);
    return NextResponse.json({ count: clients.length, clients });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<Client>;
    const now = new Date().toISOString();
    const client: Client = { id: generateId("cli"), name: body.name ?? "", legalName: body.legalName ?? "", industry: body.industry ?? "", contactName: body.contactName ?? "", contactEmail: body.contactEmail ?? "", contactPhone: body.contactPhone ?? "", address: body.address ?? "", country: body.country ?? "JP", taxRegistrationNumber: body.taxRegistrationNumber ?? "", status: body.status ?? "prospect", notes: body.notes ?? "", createdAt: now, updatedAt: now };
    await getClientService().saveClient(client);
    return NextResponse.json({ success: true, client });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
