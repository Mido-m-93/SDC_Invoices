// Mock-only clients endpoint for the Pipeline Sync review UI.
// Deliberately bypasses getClientService() (which follows NEXT_PUBLIC_USE_MOCK_STORAGE,
// "false"/real-Supabase in this project) so reviewing/creating clients while testing
// pipeline sync never writes real data. Swap to getClientService() once verified.
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { MockClientService } from "@/lib/services/mock";
import { generateId } from "@/lib/utils";
import type { Client } from "@/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const clients = await new MockClientService().listClients();
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
    const body = (await req.json()) as Partial<Client>;
    const now = new Date().toISOString();
    const client: Client = {
      id: generateId("cli"), name: body.name ?? "", legalName: body.legalName ?? "",
      industry: body.industry ?? "", contactName: body.contactName ?? "", contactEmail: body.contactEmail ?? "",
      contactPhone: body.contactPhone ?? "", address: body.address ?? "", country: body.country ?? "JP",
      taxRegistrationNumber: body.taxRegistrationNumber ?? "", status: body.status ?? "prospect",
      notes: body.notes ?? "", aliases: [], createdAt: now, updatedAt: now,
    };
    await new MockClientService().saveClient(client);
    return NextResponse.json({ success: true, client });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
