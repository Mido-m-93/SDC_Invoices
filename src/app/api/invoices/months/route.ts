import { NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";

export async function GET() {
  try {
    const months = await getStorageService().listAvailableMonths();
    return NextResponse.json({ months });
  } catch (err) {
    console.error("[GET /api/invoices/months]", err);
    return NextResponse.json({ months: [] });
  }
}
