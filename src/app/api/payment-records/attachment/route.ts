// GET /api/payment-records/attachment?invoiceId=...
//
// A payment record's invoiceId points at either an invoice submission or an
// expense claim (expense claim IDs are prefixed "exp-"). This looks up
// whichever one it is and returns its PDF/receipt attachment URL, so the
// Payment Records page can link straight to the source document.
import { NextRequest, NextResponse } from "next/server";
import { getExpenseService, getStorageService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  const invoiceId = req.nextUrl.searchParams.get("invoiceId");
  if (!invoiceId) {
    return NextResponse.json({ error: "Missing 'invoiceId' parameter" }, { status: 400 });
  }

  try {
    if (invoiceId.startsWith("exp-")) {
      const claim = await getExpenseService().getClaim(invoiceId);
      return NextResponse.json({ source: "expense", url: claim?.receiptUrl || null });
    }

    const storage = getStorageService();
    const months = await storage.listAvailableMonths();
    for (const month of months) {
      const submissions = await storage.loadSubmissionsFromStore(month);
      const match = submissions.find((s) => s.id === invoiceId);
      if (match) {
        return NextResponse.json({ source: "invoice", url: match.invoiceAttachment || null });
      }
    }
    return NextResponse.json({ source: "invoice", url: null });
  } catch (err) {
    console.error("[GET /api/payment-records/attachment]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
