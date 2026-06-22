import { NextRequest, NextResponse } from "next/server";
import { getAccountingService } from "@/lib/services";
import { generateId } from "@/lib/utils";
import { requireAuth } from "@/lib/auth-guard";
import type { AccountingEntry, AccountingEntryType, AccountingEntryStatus } from "@/types";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") ?? undefined;
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "Invalid month format. Use YYYY-MM" }, { status: 400 });
    }
    const type = searchParams.get("type") as AccountingEntryType | null;
    const status = searchParams.get("status") as AccountingEntryStatus | null;
    const svc = getAccountingService();
    const [entries, summary] = await Promise.all([
      svc.listEntries({ month, type: type ?? undefined, status: status ?? undefined }),
      month ? svc.getSummary(month) : Promise.resolve(null),
    ]);
    return NextResponse.json({ count: entries.length, entries, summary });
  } catch (err) { console.error("[API ERROR]", err); return NextResponse.json({ error: "Internal server error" }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const body = await req.json() as Partial<AccountingEntry>;
    const now = new Date().toISOString();
    const entryDate = body.entryDate ?? now.slice(0, 10);
    const entry: AccountingEntry = { id: generateId("acc"), entryDate, month: body.month ?? entryDate.slice(0, 7), type: body.type ?? "revenue", category: body.category ?? "", description: body.description ?? "", amount: body.amount ?? 0, currency: body.currency ?? "JPY", exchangeRate: body.exchangeRate ?? 1, amountJpy: body.amountJpy ?? body.amount ?? 0, status: "draft", sourceType: body.sourceType ?? "manual", sourceId: body.sourceId ?? "", clientId: body.clientId ?? "", vendorId: body.vendorId ?? "", memberId: body.memberId ?? "", notes: body.notes ?? "", postedBy: body.postedBy ?? "", postedAt: body.postedAt ?? null, createdAt: now, updatedAt: now };
    await getAccountingService().saveEntry(entry);
    return NextResponse.json({ success: true, entry });
  } catch (err) { console.error("[API ERROR]", err); return NextResponse.json({ error: "Internal server error" }, { status: 500 }); }
}
