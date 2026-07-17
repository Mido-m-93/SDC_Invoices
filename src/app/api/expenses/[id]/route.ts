import { NextRequest, NextResponse } from "next/server";
import { getExpenseService, getTrashService } from "@/lib/services";
import { generateId } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const claim = await getExpenseService().getClaim(params.id);
    if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ claim });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const svc = getExpenseService();
    const existing = await svc.getClaim(params.id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await svc.saveClaim({ ...existing, ...body, id: params.id, updatedAt: new Date().toISOString() } as typeof existing);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const svc   = getExpenseService();
    const claim = await svc.getClaim(params.id);
    if (claim) {
      await getTrashService().addToTrash({
        trashId:    generateId("trash"),
        entityType: "expense",
        entityId:   claim.id,
        entityName: `${claim.submittedBy} — ${claim.description.slice(0, 40)}`,
        deletedAt:  new Date().toISOString(),
        data:       claim,
      });
    }
    await svc.deleteClaim(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
