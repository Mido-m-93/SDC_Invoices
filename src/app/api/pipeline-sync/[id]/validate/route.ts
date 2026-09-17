// POST /api/pipeline-sync/[id]/validate
// Runs 3-stage AI matching before approving a staged pipeline record.
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getContractService, getProposalService, getBudgetService } from "@/lib/services";
import { getSupabaseClient } from "@/lib/supabase";
import { similarity } from "@/lib/services/ai/pipelineMatching";
import type { Contract, Proposal, Budget } from "@/types";

export const dynamic = "force-dynamic";

// ── Fuzzy name matching ───────────────────────────────────────────────────────
// Uses the same scorer as proposal sync and contract sync (pipelineMatching's
// `similarity`) so a client name that matches in one place matches everywhere —
// previously this route had its own separate word-overlap matcher, which could
// disagree with the app's other matchers on the same raw client name.

function bestNameScore(candidate: string, targets: string[]): number {
  return Math.max(0, ...targets.filter(Boolean).map((t) => similarity(candidate, t)));
}

function amountClose(a: number | null, b: number | null): { close: boolean; diffPct: number | null } {
  if (a == null || b == null || b === 0) return { close: false, diffPct: null };
  const diffPct = Math.round(Math.abs(a - b) / b * 100);
  return { close: diffPct <= 20, diffPct };
}

// Looser than AUTO_LINK_THRESHOLD (0.85, used to auto-link without review) —
// this just answers "does anything plausibly related already exist?" for the
// pre-approval checklist, so a lower bar is intentional, not a mismatch.
const NAME_THRESHOLD = 0.45;

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  // Load the staged record from Supabase directly
  const db = getSupabaseClient();
  const { data: row, error: rowErr } = await db
    .from("staged_pipeline_records")
    .select("*")
    .eq("id", params.id)
    .single();

  if (rowErr || !row) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  const rawClientName: string = row.raw_client_name ?? "";
  const projectName: string = row.project_name ?? "";
  const estimatedAmount: number | null = row.estimated_amount ?? null;

  // Load contracts, proposals, and budgets in parallel
  const [contracts, proposals, budgets] = await Promise.all([
    getContractService().listContracts().catch((): Contract[] => []),
    getProposalService().listProposals().catch((): Proposal[] => []),
    getBudgetService().listBudgets().catch((): Budget[] => []),
  ]);

  // ── Stage 1: Client already exists in system? ──────────────────────────────
  const contractsByName = contracts.map((c) => ({
    contract: c,
    score: bestNameScore(rawClientName, [c.clientName ?? "", c.projectName]),
  })).filter((m) => m.score >= NAME_THRESHOLD).sort((a, b) => b.score - a.score);

  const proposalsByName = proposals.map((p) => ({
    proposal: p,
    score: bestNameScore(rawClientName, [p.clientName ?? "", p.projectName]),
  })).filter((m) => m.score >= NAME_THRESHOLD).sort((a, b) => b.score - a.score);

  const budgetsByName = budgets.map((b) => ({
    budget: b,
    score: bestNameScore(rawClientName, [b.clientName ?? "", b.projectName]),
  })).filter((m) => m.score >= NAME_THRESHOLD).sort((a, b) => b.score - a.score);

  const clientExists = contractsByName.length > 0 || proposalsByName.length > 0 || budgetsByName.length > 0;

  // Best single record to link the "Client exists" badge to — whichever of
  // the three candidate lists has the highest-confidence name match.
  const clientExistsCandidates = [
    contractsByName[0] ? { score: contractsByName[0].score, url: contractsByName[0].contract.contractFolderUrl ?? null, label: "contract" as const } : null,
    proposalsByName[0] ? { score: proposalsByName[0].score, url: proposalsByName[0].proposal.folderUrl ?? null, label: "proposal" as const } : null,
    budgetsByName[0] ? { score: budgetsByName[0].score, url: budgetsByName[0].budget.folderUrl ?? null, label: "budget" as const } : null,
  ].filter((c): c is { score: number; url: string | null; label: "contract" | "proposal" | "budget" } => c !== null && c.url !== null)
    .sort((a, b) => b.score - a.score);
  const clientExistsBestMatch = clientExistsCandidates[0] ?? null;

  // ── Stage 2: Contract match (name + amount) ────────────────────────────────
  const bestContract = contractsByName[0] ?? null;
  const contractAmount = amountClose(estimatedAmount, bestContract?.contract.expectedMonthlyAmount ?? null);

  // ── Stage 3: Proposal match (name + amount) ───────────────────────────────
  const bestProposal = proposalsByName[0] ?? null;
  const proposalAmount = amountClose(estimatedAmount, bestProposal?.proposal.estimatedAmount ?? null);

  // ── Stage 4: Budget match (name + amount) ──────────────────────────────────
  const bestBudget = budgetsByName[0] ?? null;
  const budgetAmount = amountClose(estimatedAmount, bestBudget?.budget.budgetAmount ?? null);

  // ── Stage 5: Proposal ↔ Contract cross-check ──────────────────────────────
  const crossCheck = bestContract && bestProposal
    ? amountClose(bestProposal.proposal.estimatedAmount, bestContract.contract.expectedMonthlyAmount)
    : null;

  return NextResponse.json({
    recordId: params.id,
    rawClientName,
    projectName,
    estimatedAmount,
    stages: {
      clientExists: {
        pass: clientExists,
        contractCount: contractsByName.length,
        proposalCount: proposalsByName.length,
        budgetCount: budgetsByName.length,
        matchUrl: clientExistsBestMatch?.url ?? null,
        matchLabel: clientExistsBestMatch?.label ?? null,
      },
      contractMatch: {
        found: !!bestContract,
        contract: bestContract ? {
          id: bestContract.contract.id,
          projectName: bestContract.contract.projectName,
          clientName: bestContract.contract.clientName ?? null,
          expectedMonthlyAmount: bestContract.contract.expectedMonthlyAmount,
          currency: bestContract.contract.currency,
          status: bestContract.contract.status,
          folderUrl: bestContract.contract.contractFolderUrl ?? null,
          score: Math.round(bestContract.score * 100),
        } : null,
        amountClose: contractAmount,
      },
      proposalMatch: {
        found: !!bestProposal,
        proposal: bestProposal ? {
          id: bestProposal.proposal.id,
          projectName: bestProposal.proposal.projectName,
          clientName: bestProposal.proposal.clientName ?? null,
          estimatedAmount: bestProposal.proposal.estimatedAmount,
          currency: bestProposal.proposal.currency,
          status: bestProposal.proposal.status,
          folderUrl: bestProposal.proposal.folderUrl ?? null,
          score: Math.round(bestProposal.score * 100),
        } : null,
        amountClose: proposalAmount,
      },
      budgetMatch: {
        found: !!bestBudget,
        budget: bestBudget ? {
          id: bestBudget.budget.id,
          projectName: bestBudget.budget.projectName,
          clientName: bestBudget.budget.clientName ?? null,
          budgetAmount: bestBudget.budget.budgetAmount,
          currency: bestBudget.budget.currency,
          status: bestBudget.budget.status,
          folderUrl: bestBudget.budget.folderUrl ?? null,
          score: Math.round(bestBudget.score * 100),
        } : null,
        amountClose: budgetAmount,
      },
      proposalContractCross: {
        applicable: !!(bestContract && bestProposal),
        amountClose: crossCheck,
        proposalAmount: bestProposal?.proposal.estimatedAmount ?? null,
        contractAmount: bestContract?.contract.expectedMonthlyAmount ?? null,
        currency: bestContract?.contract.currency ?? bestProposal?.proposal.currency ?? "JPY",
      },
    },
  });
}
