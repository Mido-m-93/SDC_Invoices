// src/app/api/users/deleted/route.ts
// GET /api/users/deleted — lists archived (banned) user accounts, for the
// Archives page.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { listAllAuthUsers } from "@/lib/authUsers";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireAdmin();
  if (!user) return response!;

  try {
    const users = (await listAllAuthUsers())
      .filter((u) => !!u.archivedAt)
      .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
    return NextResponse.json({ count: users.length, users });
  } catch (err) {
    console.error("[GET /api/users/deleted]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
