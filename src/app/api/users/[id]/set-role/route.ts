// src/app/api/users/[id]/set-role/route.ts
// POST /api/users/[id]/set-role — promote/demote a user's admin role.
// Admin-only. Can't demote your own account (ask another admin instead) —
// prevents accidentally locking yourself out of user management.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { getSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAdmin();
  if (!user) return response!;

  try {
    const { role } = await req.json() as { role?: "admin" | "member" };
    if (role !== "admin" && role !== "member") {
      return NextResponse.json({ error: "role must be 'admin' or 'member'" }, { status: 400 });
    }
    if (params.id === user.id && role === "member") {
      return NextResponse.json({ error: "You can't remove your own admin access — ask another admin." }, { status: 400 });
    }

    const db = getSupabaseClient();
    const { data: existing, error: fetchErr } = await db.auth.admin.getUserById(params.id);
    if (fetchErr) throw new Error(fetchErr.message);

    const { error } = await db.auth.admin.updateUserById(params.id, {
      user_metadata: {
        ...(existing.user?.user_metadata ?? {}),
        role: role === "admin" ? "admin" : undefined,
      },
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/users/[id]/set-role]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
