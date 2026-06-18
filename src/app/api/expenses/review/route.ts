import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";

export async function POST(req: NextRequest) {
  try {
    const { id, decision, reviewedBy, reviewerComment } = await req.json() as {
      id: string;
      decision: "approved" | "rejected";
      reviewedBy?: string;
      reviewerComment?: string;
    };
    if (!id || !decision) return NextResponse.json({ error: "Missing id or decision" }, { status: 400 });

    const svc      = getExpenseService();
    const existing = await svc.getExpense(id);
    if (!existing) return NextResponse.json({ error: "Expense not found" }, { status: 404 });

    const updated = {
      ...existing,
      status: decision,
      reviewedBy:      reviewedBy ?? "reviewer",
      reviewedAt:      new Date().toISOString(),
      reviewerComment: reviewerComment ?? existing.reviewerComment,
    };
    await svc.saveExpense(updated);
    return NextResponse.json({ success: true, claim: updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
