// src/app/api/notifications/test/route.ts
import { NextResponse } from "next/server";
import { getNotificationService } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await getNotificationService().testConnection();
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
