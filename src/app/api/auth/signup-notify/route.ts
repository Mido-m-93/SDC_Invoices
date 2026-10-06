// src/app/api/auth/signup-notify/route.ts
// POST /api/auth/signup-notify — emails every admin about pending sign-ups they
// haven't been told about yet, then records it so each sign-up is emailed once.
// Unauthenticated on purpose: the caller is a brand-new (pending) user, whom
// requireAuth refuses. It takes no input and can only email admins about real
// pending accounts, once each.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { listAllAuthUsers } from "@/lib/authUsers";
import { usersNeedingSignupEmail, signupEmail, sendEmail, appUrl } from "@/lib/accountEmails";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const users = await listAllAuthUsers();
    const waiting = usersNeedingSignupEmail(users);
    if (waiting.length === 0) return NextResponse.json({ ok: true, sent: 0 });

    const admins = users.filter((u) => u.isAdmin && !u.archivedAt).map((u) => u.email).filter(Boolean);
    const sent = await sendEmail(admins, signupEmail(waiting.map((u) => u.email), appUrl(req.nextUrl.origin)));
    // Only mark as notified once the email actually went out, so a failure retries next time.
    if (!sent) return NextResponse.json({ ok: false, sent: 0 });

    const db = getSupabaseClient();
    const now = new Date().toISOString();
    await Promise.all(
      waiting.map((u) => db.auth.admin.updateUserById(u.id, { app_metadata: { signupNotifiedAt: now } }))
    );
    return NextResponse.json({ ok: true, sent: waiting.length });
  } catch (err) {
    console.error("[POST /api/auth/signup-notify]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
