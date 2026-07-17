// GET  /api/trash — list all trashed items
// DELETE /api/trash — empty the trash permanently

import "server-only";
import { NextResponse } from "next/server";
import { getTrashService } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await getTrashService().listTrashed();
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await getTrashService().clearTrash();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
