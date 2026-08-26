// POST /api/proposals/sync
// Scans the 30_WorkTogether SharePoint folder for proposal files,
// AI-extracts client name / project name / amount, and upserts them
// into the proposals table so Stage 3 & 4 validation have real data.
import "server-only";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getProposalService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import type { Proposal } from "@/types";

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

  const saved: string[] = [];
  const failed: string[] = [];

  for (const item of result.items) {
    const { fields, fileName } = item;
    const today = new Date().toISOString().slice(0, 10);
    const proposal: Proposal = {
      id: generateId("prop"),
      clientId: "",
      clientName: fields.clientName ?? undefined,
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
    savedNames: saved,
    failedNames: failed,
    scan: result.scan,
  });
}
