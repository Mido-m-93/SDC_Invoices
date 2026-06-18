import { NextRequest, NextResponse } from "next/server";
import { getProposalService } from "@/lib/services";
import type { Proposal } from "@/types";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json() as Partial<Proposal>;
    const proposal = { ...body, id: params.id } as Proposal;
    await getProposalService().saveProposal(proposal);
    return NextResponse.json({ success: true, proposal });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await getProposalService().deleteProposal(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
