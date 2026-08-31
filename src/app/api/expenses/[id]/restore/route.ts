import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getExpenseService().restoreClaim(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
