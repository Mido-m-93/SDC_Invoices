import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import type { ExpenseClaim } from "@/types";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const svc      = getExpenseService();
    const existing = await svc.getExpense(params.id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body    = await req.json() as Partial<ExpenseClaim>;
    const updated = { ...existing, ...body, id: params.id };
    await svc.saveExpense(updated);
    return NextResponse.json({ success: true, claim: updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await getExpenseService().deleteExpense(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
