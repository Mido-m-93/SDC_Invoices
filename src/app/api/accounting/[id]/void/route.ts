import { NextRequest, NextResponse } from "next/server";
import { getAccountingService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getAccountingService().voidEntry(params.id, user.email);
    return NextResponse.json({ success: true });
  } catch (err) { console.error("[API ERROR]", err); return NextResponse.json({ error: "Internal server error" }, { status: 500 }); }
}
