import { NextResponse } from "next/server";
import { getContractService, getVendorService } from "@/lib/services";
import { syncBusinessContracts } from "@/lib/services/real/BusinessContractSyncService";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = 'force-dynamic';

// POST /api/contracts/sync
// Pulls Client/Vendor/Partner contract PDFs from SharePoint and backfills
// dates/amount/terms on existing (matched) Contract records. Never creates
// new contracts. See BusinessContractSyncService.ts for the matching logic.
export async function POST() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  const hasAzureCreds = !!(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET);
  if (!hasAzureCreds) {
    return NextResponse.json({ error: "AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET not configured" }, { status: 500 });
  }

  try {
    const contractSvc = getContractService();
    const [contracts, vendors] = await Promise.all([
      contractSvc.listContracts(),
      getVendorService().listVendors(),
    ]);

    const result = await syncBusinessContracts(contracts, vendors, (c) => contractSvc.saveContract(c));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[API ERROR] contracts/sync", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
