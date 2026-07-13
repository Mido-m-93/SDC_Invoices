export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getPaymentRecordService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";
import type { PaymentRecord } from "@/types";

export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const { searchParams } = new URL(req.url);
    const invoiceId = searchParams.get("invoiceId") ?? undefined;
    const contractId = searchParams.get("contractId") ?? undefined;
    const records = await getPaymentRecordService().listPaymentRecords({ invoiceId, contractId });
    return NextResponse.json({ count: records.length, records });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<PaymentRecord>;
    const now = new Date().toISOString();
    const record: PaymentRecord = {
      id: generateId("pay"),
      invoiceId: body.invoiceId ?? "",
      contractId: body.contractId ?? "",
      vendorId: body.vendorId ?? "",
      amount: body.amount ?? 0,
      currency: body.currency ?? "JPY",
      paymentDate: body.paymentDate ?? "",
      paymentMethod: body.paymentMethod ?? "",
      referenceNumber: body.referenceNumber ?? "",
      status: body.status ?? "pending",
      confirmedBy: body.confirmedBy,
      confirmedAt: body.confirmedAt,
      notes: body.notes,
      createdAt: now,
    };
    await getPaymentRecordService().savePaymentRecord(record);
    return NextResponse.json({ success: true, record });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
