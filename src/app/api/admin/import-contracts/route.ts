// POST /api/admin/import-contracts
// Reads the SharePoint Client/Vendor/Partner contract folders (same tree
// BusinessContractSyncService scans) and bulk-creates a bare Contract record
// (clientName only, dates/amount left blank) for every folder found — so
// every real client/vendor/partner shows up in the app, whether or not it
// has a PDF yet. A later /api/contracts/sync run matches and backfills
// dates/amount from the real document for the ones that do have a PDF.
// Skips names that already exist as a Contract.

import { NextResponse } from "next/server";
import { getContractService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";
import {
  DEFAULT_SITE_PATH,
  getGraphToken,
  resolveSiteId,
  listFolderChildren,
  type GraphDriveItem,
} from "@/lib/services/real/graphClient";
import type { Contract } from "@/types";

const CONTRACTS_PARENT = process.env.MICROSOFT_SALES_CONTRACTS_FOLDER_PATH
  ?? "40_ExpandTogether/02_Functions/07_Legal/02_Contracts";

const BUSINESS_SUBFOLDERS = (process.env.MICROSOFT_BUSINESS_CONTRACTS_FOLDERS ?? "01_Client,02_Vendor,04_Partner")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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

    const results: { folder: string; name: string; status: "added" | "skipped_exists" }[] = [];

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
        if (existingNames.has(item.name.toLowerCase())) {
          results.push({ folder, name: item.name, status: "skipped_exists" });
          continue;
        }

        const contract: Contract = {
          id: generateId("con"),
          vendorId: "",
          clientId: "",
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
