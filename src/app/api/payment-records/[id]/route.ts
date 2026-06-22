import { NextRequest, NextResponse } from "next/server";
import { getPaymentRecordService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";
import type { PaymentRecord } from "@/types";

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<PaymentRecord>;
    const record = { ...body, id: params.id } as PaymentRecord;
    await getPaymentRecordService().savePaymentRecord(record);
    return NextResponse.json({ success: true, record });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getPaymentRecordService().deletePaymentRecord(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
