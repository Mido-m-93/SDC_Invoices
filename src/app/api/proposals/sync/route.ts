// POST /api/proposals/sync
// Scans the 30_WorkTogether SharePoint folder for proposal files,
// AI-extracts client name / project name / amount, and upserts them
// into the proposals table so Stage 3 & 4 validation have real data.
//
// No review gate: a file whose extracted client name doesn't confidently
// match an existing client gets a new client created from that raw name
// (same fallback the old staged-review "Approve" used to do by hand) —
// sync always finishes with either a saved proposal or a logged failure,
// never a pending item waiting on a human.
import "server-only";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getProposalService, getClientService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { rankClientCandidates, AUTO_LINK_THRESHOLD } from "@/lib/services/ai/pipelineMatching";
import type { Proposal, Client } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // SharePoint + AI extraction can take time

export async function POST() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  const { fetchSharePointProposals, fetchClientFolderProposals } = await import("@/lib/services/real/proposalSharePointSource");
  const service = getProposalService();
  const clientSvc = getClientService();

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

  let clients = await clientSvc.listClients();
  const existingFileIds = new Set(
    (await service.listProposals()).map((p) => p.sourceFileId).filter((id): id is string => !!id)
  );

  const saved: string[] = [];
  const failed: string[] = [];
  let skipped = 0;
  let clientsCreated = 0;

  for (const item of result.items) {
    const { fields, fileName, fileId } = item;

    // Already imported this exact SharePoint file in a prior sync — skip so
    // re-running sync doesn't create a duplicate proposal every time.
    if (existingFileIds.has(fileId)) {
      skipped++;
      continue;
    }

    const rawClientName = fields.clientName ?? "";
    const candidates = rankClientCandidates(rawClientName, clients);
    const [topCandidate] = candidates;

    let clientId: string;
    let clientName: string;
    if (topCandidate && topCandidate.score >= AUTO_LINK_THRESHOLD) {
      clientId = topCandidate.clientId;
      clientName = topCandidate.clientName;
    } else {
      // No confident match — create a new client from the raw name rather
      // than staging for review.
      const now = new Date().toISOString();
      const newClient: Client = {
        id: generateId("cli"),
        name: rawClientName || fileName,
        legalName: "",
        industry: "",
        contactName: "",
        contactEmail: "",
        contactPhone: "",
        address: "",
        country: "JP",
        taxRegistrationNumber: "",
        status: "prospect",
        notes: "Created from proposal SharePoint sync (no confident client match).",
        aliases: [],
        createdAt: now,
        updatedAt: now,
      };
      try {
        await clientSvc.saveClient(newClient);
        clients = [...clients, newClient];
        clientsCreated++;
        clientId = newClient.id;
        clientName = newClient.name;
      } catch (err) {
        console.error(`[proposals/sync] Failed to create client for "${fileName}":`, err);
        failed.push(fileName);
        continue;
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const proposal: Proposal = {
      id: generateId("prop"),
      clientId,
      clientName,
      leadId: undefined,
      projectName: fields.projectName ?? fileName,
      proposalDate: fields.proposalDate ?? today,
      estimatedAmount: fields.estimatedAmount ?? 0,
      currency: fields.currency,
      description: `Synced from SharePoint: ${fileName}`,
      status: "submitted",
      contractId: undefined,
      folderUrl: undefined,
      sourceFileId: fileId,
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
    skipped,
    clientsCreated,
    savedNames: saved,
    failedNames: failed,
    scan: result.scan,
  });
}
