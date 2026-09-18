// src/app/api/users/[id]/set-tabs/route.ts
// POST /api/users/[id]/set-tabs — restrict which sidebar tabs a Member can
// see. Admin-only. `tabs: null` clears the restriction (unrestricted access);
// admins are always unrestricted regardless of what's stored here.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { getSupabaseClient } from "@/lib/supabase";
import { MANAGEABLE_TABS } from "@/lib/navTabs";

export const dynamic = "force-dynamic";

const VALID_HREFS = new Set(MANAGEABLE_TABS.map((t) => t.href));

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireAdmin();
  if (!user) return response!;

  try {
    const { tabs } = await req.json() as { tabs?: string[] | null };
    if (tabs !== null && (!Array.isArray(tabs) || tabs.some((h) => !VALID_HREFS.has(h)))) {
      return NextResponse.json({ error: "tabs must be null or an array of known tab hrefs" }, { status: 400 });
    }

    const db = getSupabaseClient();
    const { data: existing, error: fetchErr } = await db.auth.admin.getUserById(params.id);
    if (fetchErr) throw new Error(fetchErr.message);

    const { error } = await db.auth.admin.updateUserById(params.id, {
      user_metadata: {
        ...(existing.user?.user_metadata ?? {}),
        allowedTabs: tabs ?? undefined,
      },
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/users/[id]/set-tabs]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
