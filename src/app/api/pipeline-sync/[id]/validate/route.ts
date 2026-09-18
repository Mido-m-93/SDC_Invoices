// POST /api/pipeline-sync/[id]/validate
// Runs 3-stage AI matching before approving a staged pipeline record.
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getContractService, getProposalService, getBudgetService } from "@/lib/services";
import { getSupabaseClient } from "@/lib/supabase";
import { similarity } from "@/lib/services/ai/pipelineMatching";
import { listSharePointProposalFiles } from "@/lib/services/real/proposalSharePointSource";
import { listSharePointBudgetFiles } from "@/lib/services/real/budgetSharePointSource";
import { DEFAULT_SITE_PATH, getGraphToken, resolveSiteId, listFolderChildren } from "@/lib/services/real/graphClient";
import type { Contract, Proposal, Budget } from "@/types";

export const dynamic = "force-dynamic";

const SUGGESTION_THRESHOLD = 0.2;

const CONTRACTS_PARENT = process.env.MICROSOFT_SALES_CONTRACTS_FOLDER_PATH
  ?? "40_ExpandTogether/02_Functions/07_Legal/02_Contracts";
const BUSINESS_SUBFOLDERS = (process.env.MICROSOFT_BUSINESS_CONTRACTS_FOLDERS ?? "01_Client,02_Vendor,04_Partner")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

interface Suggestion { name: string; url: string; score: number }
interface SuggestionResult { suggestion: Suggestion | null; debug: string }

// Best-guess file for one specific matched contract, scoped to that single
// client's name — never shared across multiple records (that's what caused
// wrong links before). Read-only: never saved unless the user links it
// themselves from the Contracts page.
async function suggestContractFile(clientName: string): Promise<SuggestionResult> {
  if (!clientName.trim()) return { suggestion: null, debug: "no client name to search with" };
  try {
    const token = await getGraphToken();
    const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);
    const items = (await Promise.all(
      BUSINESS_SUBFOLDERS.map((category) => listFolderChildren(siteId, `${CONTRACTS_PARENT}/${category}`, token).catch(() => []))
    )).flat();
    const ranked = items
      .filter((item) => !item.isFolder && item.webUrl)
      .map((item) => ({ name: item.name, url: item.webUrl as string, score: similarity(clientName, item.name) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked.filter((m) => m.score >= SUGGESTION_THRESHOLD)[0] ?? null;
    return {
      suggestion: best,
      debug: `scanned ${items.length} item(s) across ${BUSINESS_SUBFOLDERS.join(", ")}; top score ${ranked[0] ? Math.round(ranked[0].score * 100) + "% (" + ranked[0].name + ")" : "n/a"}`,
    };
  } catch (err) {
    console.error("[pipeline-sync validate] suggestContractFile failed:", err);
    return { suggestion: null, debug: `search failed: ${String(err)}` };
  }
}

async function suggestProposalFile(projectName: string, clientName: string | null): Promise<SuggestionResult> {
  try {
    const files = await listSharePointProposalFiles();
    const ranked = files
      .filter((f) => f.webUrl)
      .map((f) => ({ name: f.name, url: f.webUrl, score: Math.max(similarity(projectName, f.name), clientName ? similarity(clientName, f.name) : 0) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked.filter((m) => m.score >= SUGGESTION_THRESHOLD)[0] ?? null;
    return {
      suggestion: best,
      debug: `scanned ${files.length} proposal file(s); top score ${ranked[0] ? Math.round(ranked[0].score * 100) + "% (" + ranked[0].name + ")" : "n/a"}`,
    };
  } catch (err) {
    console.error("[pipeline-sync validate] suggestProposalFile failed:", err);
    return { suggestion: null, debug: `search failed: ${String(err)}` };
  }
}

async function suggestBudgetFile(projectName: string, clientName: string | null): Promise<SuggestionResult> {
  try {
    const files = await listSharePointBudgetFiles();
    const ranked = files
      .filter((f) => f.fileUrl)
      .map((f) => ({ name: f.fileName, url: f.fileUrl as string, score: Math.max(similarity(projectName, f.fileName), clientName ? similarity(clientName, f.fileName) : 0) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked.filter((m) => m.score >= SUGGESTION_THRESHOLD)[0] ?? null;
    return {
      suggestion: best,
      debug: `scanned ${files.length} budget file(s); top score ${ranked[0] ? Math.round(ranked[0].score * 100) + "% (" + ranked[0].name + ")" : "n/a"}`,
    };
  } catch (err) {
    console.error("[pipeline-sync validate] suggestBudgetFile failed:", err);
    return { suggestion: null, debug: `search failed: ${String(err)}` };
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

  // One suggestion lookup per matched-but-unlinked record — scoped to that
  // specific client/project, not shared across records.
  const noSuggestion: SuggestionResult = { suggestion: null, debug: "skipped — record already has a link or wasn't matched" };
  const [contractResult, proposalResult, budgetResult] = await Promise.all([
    bestContract && !bestContract.contract.contractFolderUrl && bestContract.contract.clientName
      ? suggestContractFile(bestContract.contract.clientName)
      : Promise.resolve(noSuggestion),
    bestProposal && !bestProposal.proposal.folderUrl
      ? suggestProposalFile(bestProposal.proposal.projectName, bestProposal.proposal.clientName ?? null)
      : Promise.resolve(noSuggestion),
    bestBudget && !bestBudget.budget.folderUrl
      ? suggestBudgetFile(bestBudget.budget.projectName, bestBudget.budget.clientName ?? null)
      : Promise.resolve(noSuggestion),
  ]);
  console.log("[pipeline-sync validate] suggestion debug —",
    "contract:", contractResult.debug, "| proposal:", proposalResult.debug, "| budget:", budgetResult.debug);

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
          .map((m) => ({ name: m.contract.projectName, url: m.contract.contractFolderUrl }))
          .filter((m): m is { name: string; url: string } => !!m.url),
        linkNote: bestContract && !bestContract.contract.contractFolderUrl
          ? `No file link saved for this contract yet — run Sync from SharePoint on the Contracts page (${contractResult.debug})`
          : null,
        suggestedLink: contractResult.suggestion,
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
          .map((m) => ({ name: m.proposal.projectName, url: m.proposal.folderUrl }))
          .filter((m): m is { name: string; url: string } => !!m.url),
        linkNote: bestProposal && !bestProposal.proposal.folderUrl
          ? `No file link saved for this proposal yet — run Sync from SharePoint on the Proposals page (${proposalResult.debug})`
          : null,
        suggestedLink: proposalResult.suggestion,
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
          .map((m) => ({ name: m.budget.projectName, url: m.budget.folderUrl }))
          .filter((m): m is { name: string; url: string } => !!m.url),
        linkNote: bestBudget && !bestBudget.budget.folderUrl
          ? `No file link saved for this budget yet — run Sync from SharePoint on the Budget page (${budgetResult.debug})`
          : null,
        suggestedLink: budgetResult.suggestion,
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
