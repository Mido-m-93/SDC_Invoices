// src/app/api/reminders/gaps/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getReminderService } from "@/lib/services";
import { monthOptions } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") ?? monthOptions(1)[0];
  const type = searchParams.get("type") ?? "missing_invoice";

  try {
    const svc = getReminderService();
    let data: unknown;

    if (type === "missing_invoice") {
      data = await svc.detectGaps(month);
    } else if (type === "stale_review") {
      data = await svc.detectStaleReviews(3);
    } else if (type === "due_date") {
      data = await svc.detectDueDateIssues(5);
    } else {
      return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
    }

    return NextResponse.json({ month, type, data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
