// src/app/api/users/route.ts
// GET  /api/users — lists active (non-archived) Supabase Auth accounts.
// POST /api/users — invites a new user by email.
// Distinct from the co-op's business "Members" entity.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getSupabaseClient } from "@/lib/supabase";
import { listAllAuthUsers } from "@/lib/authUsers";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const users = (await listAllAuthUsers())
      .filter((u) => !u.archivedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json({ count: users.length, users });
  } catch (err) {
    console.error("[GET /api/users]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const { email } = await req.json() as { email?: string };
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Provide a valid 'email'" }, { status: 400 });
    }

    const db = getSupabaseClient();
    const { data, error } = await db.auth.admin.inviteUserByEmail(email);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, id: data.user.id, email: data.user.email });
  } catch (err) {
    console.error("[POST /api/users]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
