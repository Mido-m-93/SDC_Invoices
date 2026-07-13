export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getLeadService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";
import type { Lead, LeadStage } from "@/types";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const { searchParams } = new URL(req.url);
    const stage = searchParams.get("stage") as LeadStage | null;
    const assignedTo = searchParams.get("assignedTo") ?? undefined;
    const clientId = searchParams.get("clientId") ?? undefined;
    const [leads, summary] = await Promise.all([
      getLeadService().listLeads({ stage: stage ?? undefined, assignedTo, clientId }),
      getLeadService().getSummary(),
    ]);
    return NextResponse.json({ count: leads.length, leads, summary });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<Lead>;
    const now = new Date().toISOString();
    const lead: Lead = { id: generateId("lead"), clientId: body.clientId ?? "", clientName: body.clientName ?? "", contactName: body.contactName ?? "", contactEmail: body.contactEmail ?? "", source: body.source ?? "inbound", stage: body.stage ?? "new", title: body.title ?? "", estimatedValue: body.estimatedValue ?? 0, currency: body.currency ?? "JPY", probability: body.probability ?? 50, expectedCloseDate: body.expectedCloseDate ?? "", assignedTo: body.assignedTo ?? "", proposalId: body.proposalId ?? null, notes: body.notes ?? "", lostReason: body.lostReason ?? "", createdAt: now, updatedAt: now };
    await getLeadService().saveLead(lead);
    return NextResponse.json({ success: true, lead });
  } catch (err) {
    console.error("[API ERROR]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
