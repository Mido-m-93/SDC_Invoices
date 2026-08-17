import { NextRequest, NextResponse } from "next/server";
import { getMemberService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import type { Member } from "@/types";

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<Member>;
    const member = { ...body, id: params.id, updatedAt: new Date().toISOString() } as Member;
    await getMemberService().saveMember(member);
    return NextResponse.json({ success: true, member });
  } catch (err) { console.error("[API ERROR]", err); return NextResponse.json({ error: "Internal server error" }, { status: 500 }); }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getMemberService().deleteMember(params.id);
    return NextResponse.json({ success: true });
  } catch (err) { console.error("[API ERROR]", err); return NextResponse.json({ error: "Internal server error" }, { status: 500 }); }
}
