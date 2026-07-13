export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getVendorService, getContractService } from "@/lib/services";

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);
  const [vendors, contracts] = await Promise.all([
    getVendorService().listVendors(),
    getContractService().listContracts(),
  ]);

  const enriched = contracts.map((c) => {
    const vendor = vendors.find((v) => v.id === c.vendorId);
    return {
      contractId: c.id,
      vendorId: c.vendorId,
      vendorFound: !!vendor,
      vendorName: vendor?.name ?? "(no vendor matched)",
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate || "(empty)",
      startOk: c.startDate <= today,
      endOk: !c.endDate || c.endDate >= today,
      wouldMatch:
        !!vendor &&
        vendor.status === "active" &&
        c.status === "active" &&
        c.startDate <= today &&
        (!c.endDate || c.endDate >= today),
    };
  });

  return NextResponse.json({ today, vendors, contracts, enriched });
}
