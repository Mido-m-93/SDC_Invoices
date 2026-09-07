
import { NextRequest, NextResponse } from "next/server";
import { getVendorService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";
import type { Vendor } from "@/types";

export const dynamic = 'force-dynamic';

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const svc = getVendorService();
    const vendors = await svc.listVendors();
    return NextResponse.json({ count: vendors.length, vendors });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<Vendor>;
    const vendor: Vendor = {
      id: body.id || generateId(),
      name: body.name ?? "",
      aliases: body.aliases ?? [],
      taxRegistrationNumber: body.taxRegistrationNumber ?? "",
      bankAccountLast4: body.bankAccountLast4 ?? "",
      defaultReviewer: body.defaultReviewer ?? "",
      defaultProject: body.defaultProject ?? "",
      status: body.status ?? "active",
      createdAt: body.createdAt ?? new Date().toISOString(),
    };
    await getVendorService().saveVendor(vendor);
    return NextResponse.json({ success: true, vendor });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
