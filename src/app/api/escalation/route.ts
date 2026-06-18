import { NextResponse } from "next/server";
import { getStorageService, getNotificationService } from "@/lib/services";
import { EscalationService } from "@/lib/services/real/EscalationService";

// POST /api/escalation — check all recent months for BLOCKED invoices and escalate
export async function POST() {
  try {
    const storage      = getStorageService();
    const notification = getNotificationService();
    const escalation   = new EscalationService(storage, notification);

    const months = await storage.listAvailableMonths();
    const recent = months.slice(0, 3); // check last 3 months

    const result = await escalation.checkAndEscalate(recent);
    return NextResponse.json({ success: true, months: recent, ...result });
  } catch (err) {
    console.error("[POST /api/escalation]", err);
    return NextResponse.json({ error: "Escalation check failed", detail: String(err) }, { status: 500 });
  }
}
