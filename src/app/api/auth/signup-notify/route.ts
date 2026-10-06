// src/app/api/auth/signup-notify/route.ts
// POST /api/auth/signup-notify — emails every admin about pending sign-ups they
// haven't been told about yet. Called from the /pending page.
// Unauthenticated on purpose: the caller is a brand-new (pending) user, whom
// requireAuth refuses. It takes no input, returns nothing beyond ok, and can
// only email admins about real pending accounts, once each.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { listAllAuthUsers } from "@/lib/authUsers";
import { usersNeedingSignupEmail, signupEmail, sendEmail, resolveAppUrl } from "@/lib/accountEmails";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const users = await listAllAuthUsers();
    const waiting = usersNeedingSignupEmail(users);
    if (waiting.length === 0) return NextResponse.json({ ok: true });

    // Claim before sending so overlapping calls don't email twice; only email
    // the users we actually claimed, and release them if the send fails.
    const db = getSupabaseClient();
    const setNotified = (ids: string[], value: string | null) =>
      Promise.all(ids.map(async (id) => {
        const { error } = await db.auth.admin.updateUserById(id, { app_metadata: { signupNotifiedAt: value } });
        return error ? null : id;
      }));
    const claimedIds = new Set((await setNotified(waiting.map((u) => u.id), new Date().toISOString())).filter(Boolean));
    const claimed = waiting.filter((u) => claimedIds.has(u.id));
    if (claimed.length === 0) return NextResponse.json({ ok: true });

    const admins = users.filter((u) => u.isAdmin && !u.archivedAt).map((u) => u.email).filter(Boolean);
    const sent = await sendEmail(admins, signupEmail(claimed.map((u) => u.email), resolveAppUrl(req.nextUrl.origin)));
    if (!sent) await setNotified(claimed.map((u) => u.id), null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/auth/signup-notify]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
