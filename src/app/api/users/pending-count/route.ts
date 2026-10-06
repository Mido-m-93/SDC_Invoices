// src/app/api/users/pending-count/route.ts
// GET /api/users/pending-count — number of sign-ups waiting for approval.
// Admin-only. Drives the badge next to "Users" in the sidebar.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { listAllAuthUsers } from "@/lib/authUsers";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireAdmin();
  if (!user) return response!;

  try {
    const count = (await listAllAuthUsers()).filter((u) => u.isPending && !u.archivedAt).length;
    return NextResponse.json({ count });
  } catch (err) {
    console.error("[GET /api/users/pending-count]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
