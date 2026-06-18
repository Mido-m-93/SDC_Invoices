import { NextRequest, NextResponse } from "next/server";
import { getMemberService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import type { Member } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") as Member["status"] | null;
    const role = searchParams.get("role") ?? undefined;
    const members = await getMemberService().listMembers({ status: status ?? undefined, role });
    return NextResponse.json({ count: members.length, members });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Member>;
    const now = new Date().toISOString();
    const member: Member = { id: body.id || generateId("mbr"), displayName: body.displayName ?? "", email: body.email ?? "", phone: body.phone ?? "", role: body.role ?? "other", department: body.department ?? "", employeeCode: body.employeeCode ?? "", joinDate: body.joinDate ?? "", status: body.status ?? "active", avatarUrl: body.avatarUrl ?? "", notes: body.notes ?? "", createdAt: body.createdAt ?? now, updatedAt: now };
    await getMemberService().saveMember(member);
    return NextResponse.json({ success: true, member });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
