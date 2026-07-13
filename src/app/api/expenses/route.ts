export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import type { ExpenseClaim, ExpenseStatus } from "@/types";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") as ExpenseStatus | null;
  const submittedBy = searchParams.get("submittedBy") ?? undefined;
  try {
    const svc = getExpenseService();
    const claims = await svc.listClaims({ status: status ?? undefined, submittedBy });
    return NextResponse.json({ claims });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: Partial<ExpenseClaim>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const claim: ExpenseClaim = {
    id: body.id ?? generateId(),
    submittedBy: body.submittedBy ?? "",
    submittedByEmail: body.submittedByEmail ?? "",
    submittedAt: body.submittedAt ?? now,
    category: body.category ?? "other",
    description: body.description ?? "",
    amount: body.amount ?? 0,
    currency: body.currency ?? "JPY",
    paymentMethod: body.paymentMethod ?? "personal_reimbursement",
    receiptUrl: body.receiptUrl ?? "",
    receiptFilename: body.receiptFilename ?? "",
    projectName: body.projectName ?? "",
    internalDepartment: body.internalDepartment ?? "",
    expenseDate: body.expenseDate ?? now.slice(0, 10),
    status: body.status ?? "submitted",
    reviewerComment: body.reviewerComment ?? "",
    reviewedBy: body.reviewedBy ?? "",
    reviewedAt: body.reviewedAt ?? null,
    approvedBy: body.approvedBy ?? "",
    approvedAt: body.approvedAt ?? null,
    paidAt: body.paidAt ?? null,
    extractedAmount: body.extractedAmount ?? null,
    extractedDate: body.extractedDate ?? null,
    extractedVendor: body.extractedVendor ?? null,
    policyViolations: body.policyViolations ?? [],
    createdAt: body.createdAt ?? now,
    updatedAt: now,
  };
  try {
    await getExpenseService().saveClaim(claim);
    return NextResponse.json({ claim });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
