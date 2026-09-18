// GET /api/proposals/[id]/folder-files
// Read-only: lists SharePoint pipeline files ranked by name similarity to
// this proposal's project/client name, so a reviewer can manually attach the
// right file when sync couldn't confidently auto-link one. Mirrors the
// contracts folder-files endpoint's "suggest, never auto-save" approach.
import { NextRequest, NextResponse } from "next/server";
import { getProposalService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import { similarity } from "@/lib/services/ai/pipelineMatching";
import { listSharePointProposalFiles } from "@/lib/services/real/proposalSharePointSource";

const SUGGESTION_THRESHOLD = 0.2;
const MAX_SUGGESTIONS = 20;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const proposals = await getProposalService().listProposals();
    const proposal = proposals.find((p) => p.id === params.id);
    if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });

    const files = await listSharePointProposalFiles();
    const ranked = files
      .map((f) => ({
        name: f.name,
        webUrl: f.webUrl,
        score: Math.max(
          similarity(proposal.projectName, f.name),
          proposal.clientName ? similarity(proposal.clientName, f.name) : 0
        ),
      }))
      .filter((f) => f.score >= SUGGESTION_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SUGGESTIONS);

    return NextResponse.json({ files: ranked });
  } catch (err) {
    console.error("[proposals/folder-files]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
