// src/app/api/users/bootstrap-admin/route.ts
// POST /api/users/bootstrap-admin { email }
// Promotes the given account to admin, but ONLY while no admin exists yet.
// Self-locking: once any admin exists, this endpoint refuses to run again —
// further promotions must go through an existing admin (see set-role).
// Also requires the BOOTSTRAP_ADMIN_SECRET env var to be set and sent as the
// x-bootstrap-secret header — otherwise, if no admin existed (e.g. a migration
// went wrong), any brand-new sign-up could make itself admin.

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getSupabaseClient } from "@/lib/supabase";
import { anyAdminExists, listAllAuthUsers } from "@/lib/authUsers";

export const dynamic = "force-dynamic";

function hasBootstrapSecret(req: NextRequest): boolean {
  const expected = process.env.BOOTSTRAP_ADMIN_SECRET;
  const given = req.headers.get("x-bootstrap-secret");
  if (!expected || !given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  if (!hasBootstrapSecret(req)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
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
    const { error } = await db.auth.admin.updateUserById(target.id, {
      app_metadata: { role: "admin", approval: "approved" },
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, id: target.id, email: target.email });
  } catch (err) {
    console.error("[POST /api/users/bootstrap-admin]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
