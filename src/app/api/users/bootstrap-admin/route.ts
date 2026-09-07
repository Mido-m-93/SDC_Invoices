// src/app/api/users/bootstrap-admin/route.ts
// POST /api/users/bootstrap-admin { email }
// Promotes the given account to admin, but ONLY while no admin exists yet.
// Self-locking: once any admin exists, this endpoint refuses to run again —
// further promotions must go through an existing admin (see set-role).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { anyAdminExists, listAllAuthUsers } from "@/lib/authUsers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (await anyAdminExists()) {
      return NextResponse.json(
        { error: "An admin already exists — ask them to promote you via the Users page." },
        { status: 403 }
      );
    }

    const { email } = await req.json() as { email?: string };
    if (!email) return NextResponse.json({ error: "Provide 'email'" }, { status: 400 });

    const target = (await listAllAuthUsers()).find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!target) return NextResponse.json({ error: `No account found for ${email}` }, { status: 404 });

    const db = getSupabaseClient();
    const { data: existing, error: fetchErr } = await db.auth.admin.getUserById(target.id);
    if (fetchErr) throw new Error(fetchErr.message);

    const { error } = await db.auth.admin.updateUserById(target.id, {
      user_metadata: { ...(existing.user?.user_metadata ?? {}), role: "admin" },
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, id: target.id, email: target.email });
  } catch (err) {
    console.error("[POST /api/users/bootstrap-admin]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
