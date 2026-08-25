// POST /api/pipeline-sync/[id]/validate
// Runs 3-stage AI matching before approving a staged pipeline record.
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getContractService, getProposalService } from "@/lib/services";
import { getSupabaseClient } from "@/lib/supabase";
import type { Contract, Proposal } from "@/types";

export const dynamic = "force-dynamic";

// ── Fuzzy name matching ───────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wordsA = new Set(na.split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(nb.split(" ").filter((w) => w.length > 2));
  const shared = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : shared / union;
}

function bestNameScore(candidate: string, targets: string[]): number {
  return Math.max(0, ...targets.filter(Boolean).map((t) => nameSimilarity(candidate, t)));
}

function amountClose(a: number | null, b: number | null): { close: boolean; diffPct: number | null } {
  if (a == null || b == null || b === 0) return { close: false, diffPct: null };
  const diffPct = Math.round(Math.abs(a - b) / b * 100);
  return { close: diffPct <= 20, diffPct };
}

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

  // Load contracts and proposals in parallel
  const [contracts, proposals] = await Promise.all([
    getContractService().listContracts().catch((): Contract[] => []),
    getProposalService().listProposals().catch((): Proposal[] => []),
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

  const clientExists = contractsByName.length > 0 || proposalsByName.length > 0;

  // ── Stage 2: Contract match (name + amount) ────────────────────────────────
  const bestContract = contractsByName[0] ?? null;
  const contractAmount = amountClose(estimatedAmount, bestContract?.contract.expectedMonthlyAmount ?? null);

  // ── Stage 3: Proposal match (name + amount) ───────────────────────────────
  const bestProposal = proposalsByName[0] ?? null;
  const proposalAmount = amountClose(estimatedAmount, bestProposal?.proposal.estimatedAmount ?? null);

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
    },
  });
}
