// POST /api/link-review/apply
// Body: { type: "contract" | "proposal" | "budget", id: string, webUrl: string }
// Saves a chosen SharePoint file as the folder link for one entity — the
// single write path behind every "Link" button on the /link-review page.
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getContractService, getProposalService, getBudgetService } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  const { type, id, webUrl } = await req.json() as { type?: string; id?: string; webUrl?: string };
  if (!type || !id || !webUrl) {
    return NextResponse.json({ error: "type, id, and webUrl are required" }, { status: 400 });
  }

  try {
    if (type === "contract") {
      const svc = getContractService();
      const contract = (await svc.listContracts()).find((c) => c.id === id);
      if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
      await svc.saveContract({ ...contract, contractFolderUrl: webUrl });
    } else if (type === "proposal") {
      const svc = getProposalService();
      const proposal = (await svc.listProposals()).find((p) => p.id === id);
      if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
      await svc.saveProposal({ ...proposal, folderUrl: webUrl });
    } else if (type === "budget") {
      const svc = getBudgetService();
      const budget = (await svc.listBudgets()).find((b) => b.id === id);
      if (!budget) return NextResponse.json({ error: "Budget not found" }, { status: 404 });
      await svc.saveBudget({ ...budget, folderUrl: webUrl });
    } else {
      return NextResponse.json({ error: `Unknown type "${type}"` }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[link-review/apply]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
