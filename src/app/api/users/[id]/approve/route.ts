// src/app/api/users/[id]/approve/route.ts
// POST /api/users/[id]/approve { tabs } — approve a pending sign-up and set the
// tabs they can see in the same step. Admin-only. Reject = DELETE /api/users/[id] (archive).

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { getSupabaseClient } from "@/lib/supabase";
import { isValidTabSelection } from "@/lib/navTabs";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAdmin();
  if (!user) return response!;

  try {
    const { tabs } = await req.json() as { tabs?: unknown };
    if (!isValidTabSelection(tabs)) {
      return NextResponse.json({ error: "tabs must be null or an array of known tab hrefs" }, { status: 400 });
    }

    // app_metadata is merged on update; null removes the key.
    const db = getSupabaseClient();
    const { error } = await db.auth.admin.updateUserById(params.id, {
      app_metadata: { approval: "approved", allowedTabs: tabs },
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/users/[id]/approve]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
