// src/app/api/reminders/trigger/route.ts
// Manual reminder trigger for logged-in dashboard users.
// Uses Supabase session cookie for auth — no CRON_SECRET needed.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getReminderService } from "@/lib/services";
import type { ReminderType } from "@/types";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set<string>([
  "all",
  "missing_invoice",
  "stale_review",
  "due_date_approaching",
  "due_date_overdue",
]);

function currentMonthJST(): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 7);
}

export async function POST(req: NextRequest) {
  // Verify the user is authenticated via session cookie
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }

  const { month: rawMonth, type: rawType = "all" } =
    body as { month?: string; type?: string };

  const month = rawMonth === "auto" || !rawMonth ? currentMonthJST() : rawMonth;
  const type = VALID_TYPES.has(rawType) ? rawType : "all";

  try {
    const result = await getReminderService().sendReminders(
      month,
      type as ReminderType | "all"
    );
    return NextResponse.json({ success: true, month, type, ...result });
  } catch (err) {
    console.error("[reminders/trigger]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
