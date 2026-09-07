// src/app/api/reminders/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getReminderService } from "@/lib/services";
import { monthOptions } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") ?? monthOptions(1)[0];

  try {
    const svc = await getReminderService();
    const summary = await svc.getSummary(month);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
