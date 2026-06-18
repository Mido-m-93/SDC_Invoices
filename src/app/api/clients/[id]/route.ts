import { NextRequest, NextResponse } from "next/server";
import { getClientService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import type { Client } from "@/types";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const client = await getClientService().getClient(params.id);
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ client });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<Client>;
    const client = { ...body, id: params.id, updatedAt: new Date().toISOString() } as Client;
    await getClientService().saveClient(client);
    return NextResponse.json({ success: true, client });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getClientService().deleteClient(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
