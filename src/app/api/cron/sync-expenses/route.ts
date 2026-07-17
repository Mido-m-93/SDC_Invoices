// GET /api/cron/sync-expenses
// Called by Vercel cron every 15 minutes. Fetches the RC経費精算 Microsoft Forms
// Excel from OneDrive and upserts new expense claims into Supabase.
// Secured via CRON_SECRET — Vercel injects this automatically on cron invocations.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    // Delegate to the sync-forms POST endpoint — same logic, no duplication
    const base = req.nextUrl.origin;
    const res  = await fetch(`${base}/api/expenses/sync-forms`, {
      method:  "POST",
      headers: { "x-internal-cron": "1" },
    });
    const data = await res.json() as { count?: number; error?: string };

    if (!res.ok) {
      console.error("[cron/sync-expenses] sync failed:", data.error);
      return NextResponse.json({ error: data.error }, { status: res.status });
    }

    console.log(`[cron/sync-expenses] synced ${data.count ?? 0} claims`);
    return NextResponse.json({ ok: true, count: data.count ?? 0 });
  } catch (err) {
    console.error("[cron/sync-expenses]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
