// POST /api/budgets/sync
// Scans the 30_WorkTogether SharePoint folder for budget files,
// AI-extracts client name / project name / amount, and upserts them
// into the budgets table.
import "server-only";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getBudgetService, getClientService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { rankClientCandidates, AUTO_LINK_THRESHOLD } from "@/lib/services/ai/pipelineMatching";
import { findStagedBudgetRecordByFileId, saveStagedBudgetRecord } from "@/lib/services/stagedBudgetStore";
import type { Budget, StagedBudgetRecord } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // SharePoint + AI extraction can take time

export async function POST() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  const { fetchSharePointBudgets } = await import("@/lib/services/real/budgetSharePointSource");
  const service = getBudgetService();

  let result: Awaited<ReturnType<typeof fetchSharePointBudgets>>;
  try {
    result = await fetchSharePointBudgets();
  } catch (err) {
    console.error("[budgets/sync] SharePoint scan failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  const clients = await getClientService().listClients();
  const existingFileIds = new Set(
    (await service.listBudgets()).map((b) => b.sourceFileId).filter((id): id is string => !!id)
  );

  const saved: string[] = [];
  const failed: string[] = [];
  let skipped = 0;
  let staged = 0;

  for (const item of result.items) {
    const { fields, fileName, fileUrl, folder, fileId } = item;

    // Already imported this exact SharePoint file in a prior sync — skip so
    // re-running sync doesn't create a duplicate budget every time.
    if (existingFileIds.has(fileId)) {
      skipped++;
      continue;
    }

    // budgets.client_id is a NOT NULL foreign key into clients(id) — an
    // unresolved "" clientId fails that constraint on every insert, so a
    // confident client match is required before we can save at all. Anything
    // below the auto-link threshold goes to the review queue instead of
    // failing outright, so a human can pick (or create) the right client.
    const rawClientName = fields.clientName ?? "";
    const candidates = rankClientCandidates(rawClientName, clients);
    const [topCandidate] = candidates;
    if (!topCandidate || topCandidate.score < AUTO_LINK_THRESHOLD) {
      const alreadyStaged = await findStagedBudgetRecordByFileId(fileId);
      if (alreadyStaged) {
        failed.push(fileName);
        continue;
      }
      const now = new Date().toISOString();
      const stagedRecord: StagedBudgetRecord = {
        id: generateId("sbud"),
        fileId,
        fileName,
        fileUrl,
        folder,
        rawClientName,
        projectName: fields.projectName ?? fileName,
        budgetDate: fields.budgetDate,
        budgetAmount: fields.budgetAmount,
        currency: fields.currency,
        matchCandidates: candidates,
        status: "needs_review",
        reviewerComment: null,
        createdBudgetId: null,
        createdAt: now,
        updatedAt: now,
      };
      await saveStagedBudgetRecord(stagedRecord);
      staged++;
      failed.push(fileName);
      continue;
    }

    const today = new Date().toISOString().slice(0, 10);
    const budget: Budget = {
      id: generateId("bud"),
      clientId: topCandidate.clientId,
      clientName: topCandidate.clientName,
      proposalId: undefined,
      projectName: fields.projectName ?? fileName,
      budgetAmount: fields.budgetAmount ?? 0,
      currency: fields.currency,
      budgetDate: fields.budgetDate ?? today,
      status: "draft",
      description: `Synced from SharePoint: ${fileName}`,
      folderUrl: undefined,
      sourceFileId: fileId,
      createdAt: new Date().toISOString(),
    };
    try {
      await service.saveBudget(budget);
      saved.push(budget.projectName);
    } catch (err) {
      console.error(`[budgets/sync] Failed to save "${fileName}":`, err);
      failed.push(fileName);
    }
  }

  return NextResponse.json({
    saved: saved.length,
    failed: failed.length,
    skipped,
    staged,
    savedNames: saved,
    failedNames: failed,
    scan: result.scan,
  });
}
