import { NextResponse } from "next/server";
import { getBudgetService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const budgets = await getBudgetService().listDeletedBudgets();
    return NextResponse.json({ budgets });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
