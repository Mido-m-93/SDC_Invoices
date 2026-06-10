import { NextRequest, NextResponse } from "next/server";
import { getVendorService } from "@/lib/services";
import type { Vendor } from "@/types";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json() as Partial<Vendor>;
    const vendor = { ...body, id: params.id } as Vendor;
    await getVendorService().saveVendor(vendor);
    return NextResponse.json({ success: true, vendor });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await getVendorService().deleteVendor(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
