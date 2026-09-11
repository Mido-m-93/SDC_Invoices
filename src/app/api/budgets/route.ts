import { NextRequest, NextResponse } from "next/server";
import { getBudgetService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";
import type { Budget } from "@/types";

export const dynamic = 'force-dynamic';

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const budgets = await getBudgetService().listBudgets();
    return NextResponse.json({ count: budgets.length, budgets });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<Budget>;
    const now = new Date().toISOString();
    const budget: Budget = {
      id: generateId("bud"),
      clientId: body.clientId ?? "",
      clientName: body.clientName,
      proposalId: body.proposalId,
      projectName: body.projectName ?? "",
      budgetAmount: body.budgetAmount ?? 0,
      currency: body.currency ?? "JPY",
      budgetDate: body.budgetDate ?? "",
      status: body.status ?? "draft",
      description: body.description ?? "",
      folderUrl: body.folderUrl,
      createdAt: now,
    };
    await getBudgetService().saveBudget(budget);
    return NextResponse.json({ success: true, budget });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
