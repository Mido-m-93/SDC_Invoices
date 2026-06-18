import { NextRequest, NextResponse } from "next/server";
import { getPaymentRecordService } from "@/lib/services";
import type { PaymentRecord } from "@/types";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json() as Partial<PaymentRecord>;
    const record = { ...body, id: params.id } as PaymentRecord;
    await getPaymentRecordService().savePaymentRecord(record);
    return NextResponse.json({ success: true, record });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await getPaymentRecordService().deletePaymentRecord(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
