import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

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
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getExpenseService().deleteClaim(params.id, user.email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
