// src/app/api/notifications/test/route.ts
import { NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";
import { TeamsNotificationService } from "@/lib/services/real/TeamsNotificationService";
import { SlackNotificationService } from "@/lib/services/real/SlackNotificationService";
import { MockNotificationService } from "@/lib/services/mock/notificationService";

export const dynamic = "force-dynamic";

// POST /api/notifications/test            -> test the Teams webhook (default)
// POST /api/notifications/test {channel:"slack"} -> test the Slack webhook
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { channel?: string };
    // Always read webhook URL fresh from DB
    const config = await getStorageService().loadConfig();

    if (body.channel === "slack") {
      const slackUrl = config.slackWebhookUrl;
      if (!slackUrl?.startsWith("https://")) {
        return NextResponse.json({ ok: false, message: "No Slack webhook URL is saved yet" }, { status: 400 });
      }
      const result = await new SlackNotificationService(slackUrl).testConnection();
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }

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
