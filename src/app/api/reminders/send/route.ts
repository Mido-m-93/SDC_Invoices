// src/app/api/reminders/send/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getReminderService } from "@/lib/services";
import { monthOptions } from "@/lib/utils";
import type { ReminderType } from "@/types";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set<string>([
  "all",
  "missing_invoice",
  "stale_review",
  "due_date_approaching",
  "due_date_overdue",
]);

/** Derive the current month in JST (UTC+9) */
function currentMonthJST(): string {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 7);
}

export async function POST(req: NextRequest) {
  // Optional cron secret validation (when called from GitHub Actions)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const incoming = req.headers.get("x-cron-secret");
    if (incoming !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { month: rawMonth, type: rawType = "all" } =
    body as { month?: string; type?: string };

  const month =
    rawMonth === "auto" || !rawMonth ? currentMonthJST() : rawMonth;

  const type = VALID_TYPES.has(rawType) ? rawType : "all";

  try {
    const result = await getReminderService().sendReminders(
      month,
      type as ReminderType | "all"
    );
    return NextResponse.json({ success: true, month, type, ...result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
