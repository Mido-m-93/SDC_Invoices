// src/app/api/notifications/test/route.ts
import { NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";
import { TeamsNotificationService } from "@/lib/services/real/TeamsNotificationService";
import { MockNotificationService } from "@/lib/services/mock/notificationService";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // Always read webhook URL fresh from DB
    const config = await getStorageService().loadConfig();
    const webhookUrl = config.teamsWebhookUrl;

    const svc = webhookUrl?.startsWith("https://")
      ? new TeamsNotificationService(webhookUrl)
      : new MockNotificationService();

    const result = await svc.testConnection();
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
