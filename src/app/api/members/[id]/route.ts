import { NextRequest, NextResponse } from "next/server";
import { getMemberService } from "@/lib/services";
import type { Member } from "@/types";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json() as Partial<Member>;
    const member = { ...body, id: params.id, updatedAt: new Date().toISOString() } as Member;
    await getMemberService().saveMember(member);
    return NextResponse.json({ success: true, member });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await getMemberService().deleteMember(params.id);
    return NextResponse.json({ success: true });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
