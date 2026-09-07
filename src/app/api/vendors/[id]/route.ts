import { NextRequest, NextResponse } from "next/server";
import { getVendorService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import type { Vendor } from "@/types";

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<Vendor>;
    const vendor = { ...body, id: params.id } as Vendor;
    await getVendorService().saveVendor(vendor);
    return NextResponse.json({ success: true, vendor });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getVendorService().deleteVendor(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
