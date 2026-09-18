// GET /api/budgets/[id]/folder-files
// Read-only: lists SharePoint budget files ranked by name similarity to this
// budget's project/client name, so a reviewer can manually attach the right
// file when nothing was auto-linked. Mirrors the contracts/proposals
// folder-files endpoints' "suggest, never auto-save" approach.
import { NextRequest, NextResponse } from "next/server";
import { getBudgetService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import { similarity } from "@/lib/services/ai/pipelineMatching";
import { listSharePointBudgetFiles } from "@/lib/services/real/budgetSharePointSource";

const SUGGESTION_THRESHOLD = 0.2;
const MAX_SUGGESTIONS = 20;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const budgets = await getBudgetService().listBudgets();
    const budget = budgets.find((b) => b.id === params.id);
    if (!budget) return NextResponse.json({ error: "Budget not found" }, { status: 404 });

    const files = await listSharePointBudgetFiles();
    const ranked = files
      .filter((f) => f.fileUrl)
      .map((f) => ({
        name: f.fileName,
        webUrl: f.fileUrl as string,
        score: Math.max(
          similarity(budget.projectName, f.fileName),
          budget.clientName ? similarity(budget.clientName, f.fileName) : 0
        ),
      }))
      .filter((f) => f.score >= SUGGESTION_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SUGGESTIONS);

    return NextResponse.json({ files: ranked });
  } catch (err) {
    console.error("[budgets/folder-files]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
