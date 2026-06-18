import { NextRequest, NextResponse } from "next/server";
import { getClientService } from "@/lib/services";
import type { Client } from "@/types";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const client = await getClientService().getClient(params.id);
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ client });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json() as Partial<Client>;
    const client = { ...body, id: params.id, updatedAt: new Date().toISOString() } as Client;
    await getClientService().saveClient(client);
    return NextResponse.json({ success: true, client });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await getClientService().deleteClient(params.id);
    return NextResponse.json({ success: true });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
