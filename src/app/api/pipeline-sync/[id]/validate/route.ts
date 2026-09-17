// POST /api/pipeline-sync/[id]/validate
// Runs 3-stage AI matching before approving a staged pipeline record.
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getContractService, getProposalService, getBudgetService } from "@/lib/services";
import { getSupabaseClient } from "@/lib/supabase";
import { similarity } from "@/lib/services/ai/pipelineMatching";
import { getGraphToken, resolveSiteId, searchDriveItems, DEFAULT_SITE_PATH } from "@/lib/services/real/graphClient";
import type { Contract, Proposal, Budget } from "@/types";

export const dynamic = "force-dynamic";

// Some contracts/proposals/budgets have no folderUrl saved on the record
// itself (e.g. a contract auto-created when a proposal is accepted starts
// with contractFolderUrl left blank for the user to fill in later). Rather
// than show no link at all when we know the record exists, fall back to a
// live SharePoint filename search by client name — same lookup used by the
// Pipeline Sync page's search box — and link to whatever the top hit is.
async function findSharePointFallbackUrl(clientName: string): Promise<{ url: string | null; note: string | null }> {
  const hasAzureCreds = !!(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET);
  if (!hasAzureCreds || !clientName.trim()) return { url: null, note: null };
  try {
    const token = await getGraphToken();
    const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);
    const results = await searchDriveItems(siteId, clientName, token);
    const url = results.find((r) => r.webUrl)?.webUrl ?? null;
    return url ? { url, note: null } : { url: null, note: `No SharePoint file found matching "${clientName}"` };
  } catch (err) {
    // Surfaced to the panel too (not just server logs) so a broken Graph
    // lookup doesn't just look like "no link" with no explanation.
    console.error("[pipeline-sync validate] SharePoint fallback search failed", err);
    return { url: null, note: "SharePoint search failed — check server logs" };
  }
}

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

  // Fuzzy-match candidates by client name, above NAME_THRESHOLD
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

  // ── Stage 1: Contract match (name + amount) ────────────────────────────────
  const bestContract = contractsByName[0] ?? null;
  const contractAmount = amountClose(estimatedAmount, bestContract?.contract.expectedMonthlyAmount ?? null);

  // ── Stage 2: Proposal match (name + amount) ───────────────────────────────
  const bestProposal = proposalsByName[0] ?? null;
  const proposalAmount = amountClose(estimatedAmount, bestProposal?.proposal.estimatedAmount ?? null);

  // ── Stage 3: Budget match (name + amount) ──────────────────────────────────
  const bestBudget = budgetsByName[0] ?? null;
  const budgetAmount = amountClose(estimatedAmount, bestBudget?.budget.budgetAmount ?? null);

  // ── Stage 4: Proposal ↔ Contract cross-check ──────────────────────────────
  const crossCheck = bestContract && bestProposal
    ? amountClose(bestProposal.proposal.estimatedAmount, bestContract.contract.expectedMonthlyAmount)
    : null;

  // ── Stage 5: 3-way amount consistency (Proposal ↔ Contract ↔ Budget) ──────
  const proposalAmt = bestProposal?.proposal.estimatedAmount ?? null;
  const contractAmt = bestContract?.contract.expectedMonthlyAmount ?? null;
  const budgetAmt = bestBudget?.budget.budgetAmount ?? null;
  const matchedAmountCount = [proposalAmt, contractAmt, budgetAmt].filter((v) => v != null).length;
  const pairApplicable = (a: number | null, b: number | null) => a != null && b != null;
  const proposalVsContract = pairApplicable(proposalAmt, contractAmt) ? amountClose(proposalAmt, contractAmt) : null;
  const proposalVsBudget = pairApplicable(proposalAmt, budgetAmt) ? amountClose(proposalAmt, budgetAmt) : null;
  const contractVsBudget = pairApplicable(contractAmt, budgetAmt) ? amountClose(contractAmt, budgetAmt) : null;
  const threeWayApplicablePairs = [proposalVsContract, proposalVsBudget, contractVsBudget].filter(
    (p): p is { close: boolean; diffPct: number | null } => p !== null
  );

  // Only bother searching SharePoint if at least one matched record is
  // missing its saved folderUrl.
  const anyMissingFolderUrl =
    contractsByName.some((m) => !m.contract.contractFolderUrl) ||
    proposalsByName.some((m) => !m.proposal.folderUrl) ||
    budgetsByName.some((m) => !m.budget.folderUrl);
  const sharePointFallback = anyMissingFolderUrl
    ? await findSharePointFallbackUrl(rawClientName)
    : { url: null, note: null };

  return NextResponse.json({
    recordId: params.id,
    rawClientName,
    projectName,
    estimatedAmount,
    stages: {
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
        allMatches: contractsByName
          .map((m) => ({ name: m.contract.projectName, url: m.contract.contractFolderUrl || sharePointFallback.url }))
          .filter((m): m is { name: string; url: string } => !!m.url),
        linkNote: bestContract && !bestContract.contract.contractFolderUrl && !sharePointFallback.url
          ? sharePointFallback.note ?? "No file link found for this record"
          : null,
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
        allMatches: proposalsByName
          .map((m) => ({ name: m.proposal.projectName, url: m.proposal.folderUrl || sharePointFallback.url }))
          .filter((m): m is { name: string; url: string } => !!m.url),
        linkNote: bestProposal && !bestProposal.proposal.folderUrl && !sharePointFallback.url
          ? sharePointFallback.note ?? "No file link found for this record"
          : null,
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
        allMatches: budgetsByName
          .map((m) => ({ name: m.budget.projectName, url: m.budget.folderUrl || sharePointFallback.url }))
          .filter((m): m is { name: string; url: string } => !!m.url),
        linkNote: bestBudget && !bestBudget.budget.folderUrl && !sharePointFallback.url
          ? sharePointFallback.note ?? "No file link found for this record"
          : null,
      },
      proposalContractCross: {
        applicable: !!(bestContract && bestProposal),
        amountClose: crossCheck,
        proposalAmount: bestProposal?.proposal.estimatedAmount ?? null,
        contractAmount: bestContract?.contract.expectedMonthlyAmount ?? null,
        currency: bestContract?.contract.currency ?? bestProposal?.proposal.currency ?? "JPY",
      },
      threeWayCross: {
        applicable: matchedAmountCount >= 2,
        allClose: threeWayApplicablePairs.length > 0 && threeWayApplicablePairs.every((p) => p.close),
        proposalAmount: proposalAmt,
        contractAmount: contractAmt,
        budgetAmount: budgetAmt,
        currency: bestContract?.contract.currency ?? bestProposal?.proposal.currency ?? bestBudget?.budget.currency ?? "JPY",
        proposalVsContract,
        proposalVsBudget,
        contractVsBudget,
      },
    },
  });
}
