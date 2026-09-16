
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
    const svc = getVendorService();

    // Guard against duplicate vendors: a new (no id) submission for a name
    // that already exists updates that vendor instead of inserting another
    // row — saveVendor() only dedupes by id, not by name.
    let existing: Vendor | undefined;
    if (!body.id && body.name) {
      const name = body.name.toLowerCase();
      existing = (await svc.listVendors()).find((v) => v.name.toLowerCase() === name);
    }

    const vendor: Vendor = {
      id: existing?.id ?? body.id ?? generateId(),
      name: body.name ?? existing?.name ?? "",
      aliases: body.aliases ?? existing?.aliases ?? [],
      taxRegistrationNumber: body.taxRegistrationNumber ?? existing?.taxRegistrationNumber ?? "",
      bankAccountLast4: body.bankAccountLast4 ?? existing?.bankAccountLast4 ?? "",
      defaultReviewer: body.defaultReviewer ?? existing?.defaultReviewer ?? "",
      defaultProject: body.defaultProject ?? existing?.defaultProject ?? "",
      status: body.status ?? existing?.status ?? "active",
      createdAt: existing?.createdAt ?? body.createdAt ?? new Date().toISOString(),
    };
    await svc.saveVendor(vendor);
    return NextResponse.json({ success: true, vendor, deduped: !!existing });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
