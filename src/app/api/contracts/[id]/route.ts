import { NextRequest, NextResponse } from "next/server";
import { getContractService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import type { Contract } from "@/types";

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<Contract>;
    const contract = { ...body, id: params.id } as Contract;
    await getContractService().saveContract(contract);
    return NextResponse.json({ success: true, contract });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getContractService().deleteContract(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
