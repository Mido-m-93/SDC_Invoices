// src/app/api/reminders/trigger/route.ts
// Manual reminder trigger for logged-in dashboard users.
// Uses Supabase session cookie for auth — no CRON_SECRET needed.
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getReminderService } from "@/lib/services";
import type { ReminderType } from "@/types";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set<string>([
  "all",
  "missing_invoice",
  "stale_review",
  "due_date_approaching",
  "due_date_overdue",
  "contract_expired",
]);

function currentMonthJST(): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 7);
}

export async function POST(req: NextRequest) {
  // Shared guard: signed in AND approved (pending sign-ups are refused).
  const { user, response } = await requireAuth();
  if (!user) return response!;

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }

  const { month: rawMonth, type: rawType = "all" } =
    body as { month?: string; type?: string };

  const month = rawMonth === "auto" || !rawMonth ? currentMonthJST() : rawMonth;
  const type = VALID_TYPES.has(rawType) ? rawType : "all";

  try {
    const svc = await getReminderService();
    const result = await svc.sendReminders(
      month,
      type as ReminderType | "all"
    );
    return NextResponse.json({ success: true, month, type, ...result });
  } catch (err) {
    console.error("[reminders/trigger]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
