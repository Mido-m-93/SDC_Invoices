import { NextRequest, NextResponse } from "next/server";
import { getProposalService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getProposalService().restoreProposal(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
