// src/app/api/users/[id]/restore/route.ts
// POST /api/users/[id]/restore — lifts the archive ban set by DELETE /api/users/[id].

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { getSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAdmin();
  if (!user) return response!;

  try {
    const db = getSupabaseClient();
    const { data: existing, error: fetchErr } = await db.auth.admin.getUserById(params.id);
    if (fetchErr) throw new Error(fetchErr.message);

    const metadata = { ...(existing.user?.user_metadata ?? {}) };
    delete metadata.archived_at;
    delete metadata.archived_by;

    const { error } = await db.auth.admin.updateUserById(params.id, {
      ban_duration: "none",
      user_metadata: metadata,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/users/[id]/restore]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
