import { NextRequest, NextResponse } from "next/server";
import { getContractService } from "@/lib/services";
import type { Contract } from "@/types";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json() as Partial<Contract>;
    const contract = { ...body, id: params.id } as Contract;
    await getContractService().saveContract(contract);
    return NextResponse.json({ success: true, contract });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await getContractService().deleteContract(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
