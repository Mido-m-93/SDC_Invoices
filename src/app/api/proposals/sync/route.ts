// POST /api/proposals/sync
// Scans the 30_WorkTogether SharePoint folder for proposal files,
// AI-extracts client name / project name / amount, and upserts them
// into the proposals table so Stage 3 & 4 validation have real data.
import "server-only";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getProposalService, getClientService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { rankClientCandidates, AUTO_LINK_THRESHOLD } from "@/lib/services/ai/pipelineMatching";
import { findStagedProposalRecordByFileId, saveStagedProposalRecord } from "@/lib/services/stagedProposalStore";
import type { Proposal, StagedProposalRecord } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // SharePoint + AI extraction can take time

export async function POST() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  const { fetchSharePointProposals, fetchClientFolderProposals } = await import("@/lib/services/real/proposalSharePointSource");
  const service = getProposalService();

  let result: Awaited<ReturnType<typeof fetchSharePointProposals>>;
  try {
    const [flatScan, clientFolderScan] = await Promise.all([
      fetchSharePointProposals(),
      fetchClientFolderProposals(),
    ]);
    const seenFileIds = new Set(flatScan.items.map((i) => i.fileId));
    result = {
      items: [...flatScan.items, ...clientFolderScan.items.filter((i) => !seenFileIds.has(i.fileId))],
      scan: [...flatScan.scan, ...clientFolderScan.scan],
    };
  } catch (err) {
    console.error("[proposals/sync] SharePoint scan failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  const clients = await getClientService().listClients();

  const saved: string[] = [];
  const failed: string[] = [];
  let staged = 0;

  for (const item of result.items) {
    const { fields, fileName, folder, fileId } = item;

    // proposals.client_id is a NOT NULL foreign key into clients(id) — an
    // unresolved "" clientId fails that constraint on every insert, so a
    // confident client match is required before we can save at all. Anything
    // below the auto-link threshold goes to the review queue instead of
    // failing outright, so a human can pick (or create) the right client.
    const rawClientName = fields.clientName ?? "";
    const candidates = rankClientCandidates(rawClientName, clients);
    const [topCandidate] = candidates;
    if (!topCandidate || topCandidate.score < AUTO_LINK_THRESHOLD) {
      const alreadyStaged = await findStagedProposalRecordByFileId(fileId);
      if (alreadyStaged) {
        failed.push(fileName);
        continue;
      }
      const now = new Date().toISOString();
      const stagedRecord: StagedProposalRecord = {
        id: generateId("sprop"),
        fileId,
        fileName,
        folder,
        rawClientName,
        projectName: fields.projectName ?? fileName,
        proposalDate: fields.proposalDate,
        estimatedAmount: fields.estimatedAmount,
        currency: fields.currency,
        matchCandidates: candidates,
        status: "needs_review",
        reviewerComment: null,
        createdProposalId: null,
        createdAt: now,
        updatedAt: now,
      };
      await saveStagedProposalRecord(stagedRecord);
      staged++;
      failed.push(fileName);
      continue;
    }

    const today = new Date().toISOString().slice(0, 10);
    const proposal: Proposal = {
      id: generateId("prop"),
      clientId: topCandidate.clientId,
      clientName: topCandidate.clientName,
      leadId: undefined,
      projectName: fields.projectName ?? fileName,
      proposalDate: fields.proposalDate ?? today,
      estimatedAmount: fields.estimatedAmount ?? 0,
      currency: fields.currency,
      description: `Synced from SharePoint: ${fileName}`,
      status: "submitted",
      contractId: undefined,
      folderUrl: undefined,
      createdAt: new Date().toISOString(),
    };
    try {
      await service.saveProposal(proposal);
      saved.push(proposal.projectName);
    } catch (err) {
      console.error(`[proposals/sync] Failed to save "${fileName}":`, err);
      failed.push(fileName);
    }
  }

  return NextResponse.json({
    saved: saved.length,
    failed: failed.length,
    staged,
    savedNames: saved,
    failedNames: failed,
    scan: result.scan,
  });
}
