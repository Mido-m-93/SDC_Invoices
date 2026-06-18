import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import type { ExpenseClaim } from "@/types";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;
  const month  = searchParams.get("month")  ?? undefined;
  try {
    const svc    = getExpenseService();
    const claims = await svc.listExpenses({ status, month });
    return NextResponse.json({ count: claims.length, claims });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body  = await req.json() as Partial<ExpenseClaim>;
    const claim: ExpenseClaim = {
      id:               body.id || generateId(),
      submittedBy:      body.submittedBy ?? "",
      submittedByEmail: body.submittedByEmail ?? "",
      submittedAt:      body.submittedAt ?? new Date().toISOString(),
      category:         body.category ?? "other",
      purpose:          body.purpose ?? "",
      amount:           body.amount ?? 0,
      currency:         body.currency ?? "JPY",
      receiptAttachment: body.receiptAttachment,
      receiptFilename:  body.receiptFilename,
      projectName:      body.projectName,
      notes:            body.notes,
      status:           body.status ?? "submitted",
      issues:           [],
      createdAt:        body.createdAt ?? new Date().toISOString(),
    };
    await getExpenseService().saveExpense(claim);
    return NextResponse.json({ success: true, claim });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
