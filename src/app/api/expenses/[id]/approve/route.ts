import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { approvedBy?: string; comment?: string; action?: "approve" | "reject" };
  try { body = await req.json(); } catch { body = {}; }
  const status = body.action === "reject" ? "rejected" : "approved";
  try {
    await getExpenseService().updateStatus(params.id, status, body.approvedBy ?? "system", body.comment);
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
