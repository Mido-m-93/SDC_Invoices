// src/app/api/users/[id]/route.ts
// DELETE /api/users/[id] — archives a user's account (reversible ban, not a
// real delete — see ARCHIVE_BAN_DURATION). Restore via POST /api/users/[id]/restore.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { getSupabaseClient } from "@/lib/supabase";
import { ARCHIVE_BAN_DURATION } from "@/lib/authUsers";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAdmin();
  if (!user) return response!;

  if (params.id === user.id) {
    return NextResponse.json({ error: "You can't remove your own account." }, { status: 400 });
  }

  try {
    const db = getSupabaseClient();
    const { data: existing, error: fetchErr } = await db.auth.admin.getUserById(params.id);
    if (fetchErr) throw new Error(fetchErr.message);

    const { error } = await db.auth.admin.updateUserById(params.id, {
      ban_duration: ARCHIVE_BAN_DURATION,
      user_metadata: {
        ...(existing.user?.user_metadata ?? {}),
        archived_at: new Date().toISOString(),
        archived_by: user.email,
      },
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/users/[id]]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
