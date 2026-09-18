// GET /api/link-review
// One combined list of every contract/proposal/budget still missing a
// SharePoint folder link, each with its best-guess match (if any), so a
// reviewer can work through the whole backlog from one screen instead of
// opening "View Files" one record at a time. Never writes anything — linking
// still happens via the existing per-entity PUT routes, one explicit click
// at a time.
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getContractService, getProposalService, getBudgetService } from "@/lib/services";
import { similarity } from "@/lib/services/ai/pipelineMatching";
import { listSharePointProposalFiles } from "@/lib/services/real/proposalSharePointSource";
import { listSharePointBudgetFiles } from "@/lib/services/real/budgetSharePointSource";
import {
  DEFAULT_SITE_PATH,
  getGraphToken,
  resolveSiteId,
  listFolderChildren,
  type GraphDriveItem,
} from "@/lib/services/real/graphClient";

export const dynamic = "force-dynamic";

const SUGGESTION_THRESHOLD = 0.2;

const CONTRACTS_PARENT = process.env.MICROSOFT_SALES_CONTRACTS_FOLDER_PATH
  ?? "40_ExpandTogether/02_Functions/07_Legal/02_Contracts";
const BUSINESS_SUBFOLDERS = (process.env.MICROSOFT_BUSINESS_CONTRACTS_FOLDERS ?? "01_Client,02_Vendor,04_Partner")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

interface ReviewRow {
  type: "contract" | "proposal" | "budget";
  id: string;
  name: string;
  clientName: string | null;
  bestMatch: { name: string; score: number; webUrl: string | null; isFolder: boolean } | null;
}

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const [contracts, proposals, budgets] = await Promise.all([
      getContractService().listContracts(),
      getProposalService().listProposals(),
      getBudgetService().listBudgets(),
    ]);

    const unlinkedContracts = contracts.filter((c) => !c.contractFolderUrl);
    const unlinkedProposals = proposals.filter((p) => !p.folderUrl);
    const unlinkedBudgets = budgets.filter((b) => !b.folderUrl);

    const rows: ReviewRow[] = [];

    // ── Contracts: one top-level folder listing across all categories,
    // reused for every unlinked contract's best-match lookup. ────────────────
    if (unlinkedContracts.length > 0) {
      try {
        const token = await getGraphToken();
        const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);
        const topLevelItems: GraphDriveItem[] = [];
        for (const category of BUSINESS_SUBFOLDERS) {
          try {
            topLevelItems.push(...await listFolderChildren(siteId, `${CONTRACTS_PARENT}/${category}`, token));
          } catch {
            // category folder not accessible — skip, other categories still checked
          }
        }
        for (const c of unlinkedContracts) {
          if (!c.clientName) {
            rows.push({ type: "contract", id: c.id, name: c.projectName || c.clientName || c.id, clientName: c.clientName ?? null, bestMatch: null });
            continue;
          }
          const best = topLevelItems
            .map((item) => ({ item, score: similarity(c.clientName as string, item.name) }))
            .filter((m) => m.score >= SUGGESTION_THRESHOLD)
            .sort((a, b) => b.score - a.score)[0];
          rows.push({
            type: "contract",
            id: c.id,
            name: c.projectName || c.clientName,
            clientName: c.clientName,
            bestMatch: best ? { name: best.item.name, score: best.score, webUrl: best.item.webUrl ?? null, isFolder: best.item.isFolder } : null,
          });
        }
      } catch (err) {
        console.error("[link-review] contract lookup failed:", err);
        for (const c of unlinkedContracts) {
          rows.push({ type: "contract", id: c.id, name: c.projectName || c.clientName || c.id, clientName: c.clientName ?? null, bestMatch: null });
        }
      }
    }

    // ── Proposals: one flat file listing, reused for every unlinked proposal. ─
    if (unlinkedProposals.length > 0) {
      try {
        const files = await listSharePointProposalFiles();
        for (const p of unlinkedProposals) {
          const best = files
            .map((f) => ({
              file: f,
              score: Math.max(similarity(p.projectName, f.name), p.clientName ? similarity(p.clientName, f.name) : 0),
            }))
            .filter((m) => m.score >= SUGGESTION_THRESHOLD)
            .sort((a, b) => b.score - a.score)[0];
          rows.push({
            type: "proposal",
            id: p.id,
            name: p.projectName,
            clientName: p.clientName ?? null,
            bestMatch: best ? { name: best.file.name, score: best.score, webUrl: best.file.webUrl, isFolder: false } : null,
          });
        }
      } catch (err) {
        console.error("[link-review] proposal lookup failed:", err);
        for (const p of unlinkedProposals) {
          rows.push({ type: "proposal", id: p.id, name: p.projectName, clientName: p.clientName ?? null, bestMatch: null });
        }
      }
    }

    // ── Budgets: same pattern as proposals. ───────────────────────────────────
    if (unlinkedBudgets.length > 0) {
      try {
        const files = await listSharePointBudgetFiles();
        for (const b of unlinkedBudgets) {
          const best = files
            .filter((f) => f.fileUrl)
            .map((f) => ({
              file: f,
              score: Math.max(similarity(b.projectName, f.fileName), b.clientName ? similarity(b.clientName, f.fileName) : 0),
            }))
            .filter((m) => m.score >= SUGGESTION_THRESHOLD)
            .sort((a, b2) => b2.score - a.score)[0];
          rows.push({
            type: "budget",
            id: b.id,
            name: b.projectName,
            clientName: b.clientName ?? null,
            bestMatch: best ? { name: best.file.fileName, score: best.score, webUrl: best.file.fileUrl, isFolder: false } : null,
          });
        }
      } catch (err) {
        console.error("[link-review] budget lookup failed:", err);
        for (const b of unlinkedBudgets) {
          rows.push({ type: "budget", id: b.id, name: b.projectName, clientName: b.clientName ?? null, bestMatch: null });
        }
      }
    }

    // Best matches first within each type, so the easiest wins surface at the top.
    rows.sort((a, b) => (b.bestMatch?.score ?? -1) - (a.bestMatch?.score ?? -1));

    return NextResponse.json({ rows, total: rows.length });
  } catch (err) {
    console.error("[link-review]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
