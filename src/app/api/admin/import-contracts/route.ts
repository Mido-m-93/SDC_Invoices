// POST /api/admin/import-contracts
// Reads the SharePoint Client/Vendor/Partner contract folders (same tree
// BusinessContractSyncService scans) and bulk-creates bare Contract records
// (clientName only, dates/amount left blank) for every folder that actually
// has a PDF inside — so a later /api/contracts/sync run has something to
// match against and can backfill dates/amount from the real document.
// Skips folders with no PDF and names that already exist as a Contract.

import { NextResponse } from "next/server";
import { getContractService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";
import {
  DEFAULT_SITE_PATH,
  getGraphToken,
  resolveSiteId,
  listFolderChildren,
  listItemsByFolderId,
  type GraphDriveItem,
} from "@/lib/services/real/graphClient";
import type { Contract } from "@/types";

const CONTRACTS_PARENT = process.env.MICROSOFT_SALES_CONTRACTS_FOLDER_PATH
  ?? "40_ExpandTogether/02_Functions/07_Legal/02_Contracts";

const BUSINESS_SUBFOLDERS = (process.env.MICROSOFT_BUSINESS_CONTRACTS_FOLDERS ?? "01_Client,02_Vendor,04_Partner")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function hasPdf(siteId: string, token: string, item: GraphDriveItem): Promise<boolean> {
  if (!item.isFolder) return item.name.toLowerCase().endsWith(".pdf");
  const children = await listItemsByFolderId(siteId, item.id, token);
  return children.some((c) => !c.isFolder && c.name.toLowerCase().endsWith(".pdf"));
}

export async function POST() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const token = await getGraphToken();
    const siteId = await resolveSiteId(DEFAULT_SITE_PATH, token);
    const contractSvc = getContractService();

    const existing = await contractSvc.listContracts();
    const existingNames = new Set(
      existing.map((c) => c.clientName?.toLowerCase()).filter((n): n is string => !!n)
    );

    const results: { folder: string; name: string; status: "added" | "skipped_exists" | "skipped_no_pdf" }[] = [];

    for (const folder of BUSINESS_SUBFOLDERS) {
      const folderPath = `${CONTRACTS_PARENT}/${folder}`;
      let items: GraphDriveItem[];
      try {
        items = await listFolderChildren(siteId, folderPath, token);
      } catch (err) {
        console.error(`[import-contracts] Could not list ${folder}:`, err);
        continue;
      }

      for (const item of items) {
        if (!(await hasPdf(siteId, token, item).catch(() => false))) {
          results.push({ folder, name: item.name, status: "skipped_no_pdf" });
          continue;
        }

        if (existingNames.has(item.name.toLowerCase())) {
          results.push({ folder, name: item.name, status: "skipped_exists" });
          continue;
        }

        const contract: Contract = {
          id: generateId("con"),
          vendorId: "",
          clientName: item.name,
          projectName: "",
          startDate: "",
          endDate: "",
          expectedMonthlyAmount: 0,
          currency: "JPY",
          paymentTerms: "",
          status: "active",
          createdAt: new Date().toISOString(),
        };
        await contractSvc.saveContract(contract);
        existingNames.add(item.name.toLowerCase());
        results.push({ folder, name: item.name, status: "added" });
      }
    }

    const added = results.filter((r) => r.status === "added").length;
    const skipped = results.length - added;
    return NextResponse.json({ success: true, added, skipped, results });
  } catch (err) {
    console.error("[import-contracts]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
