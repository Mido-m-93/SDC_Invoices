import { NextRequest, NextResponse } from "next/server";
import { getBudgetService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import type { Budget } from "@/types";

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<Budget>;
    const budget = { ...body, id: params.id } as Budget;
    await getBudgetService().saveBudget(budget);
    return NextResponse.json({ success: true, budget });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getBudgetService().deleteBudget(params.id, user.email);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
