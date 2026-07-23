// POST /api/expenses/[id]/send-to-mf
import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { MoneyForwardService } from "@/lib/services/real/MoneyForwardService";
import { downloadSharePointFile } from "@/lib/services/real/SharePointContractService";

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const claim = await getExpenseService().getClaim(params.id);
  if (!claim) {
    return NextResponse.json({ error: "Expense claim not found" }, { status: 404 });
  }

  if (claim.status !== "approved" && claim.status !== "paid") {
    return NextResponse.json(
      {
        error: "Cannot send to Money Forward",
        reason: `Status is ${claim.status}. Only approved (or paid) claims can be sent.`,
      },
      { status: 422 }
    );
  }

  try {
    let pdfData: Uint8Array | undefined;
    let pdfFilename: string | undefined;

    if (claim.receiptUrl) {
      try {
        pdfData = await downloadSharePointFile(claim.receiptUrl);
        pdfFilename = claim.receiptFilename || "receipt.pdf";
      } catch (fetchErr) {
        // Receipt fetch failure is non-fatal — still register the expense in MF
        console.warn("[send-to-mf] Could not fetch receipt:", fetchErr);
      }
    }

    const mfService = new MoneyForwardService();
    const result = await mfService.sendInvoice({
      partnerName: claim.submittedBy,
      title: buildTitle(claim),
      billingDate: claim.expenseDate,
      amount: claim.amount,
      currency: claim.currency === "USD" ? "USD" : "JPY",
      memo: claim.description,
      pdfData,
      pdfFilename,
    });

    const updated = {
      ...claim,
      mfBillingId: result.billingId,
      mfBillingUrl: result.billingUrl,
      mfSentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await getExpenseService().saveClaim(updated);

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = String(err);

    if (message.includes("MF_ACCESS_TOKEN not set") || message.includes("401")) {
      return NextResponse.json(
        {
          error: "Money Forward not connected",
          action: "Visit /api/auth/moneyforward to authorize the app",
        },
        { status: 401 }
      );
    }

    console.error("[POST /api/expenses/[id]/send-to-mf]", err);
    return NextResponse.json(
      { error: "Failed to send to Money Forward", detail: message },
      { status: 500 }
    );
  }
}

function buildTitle(c: { submittedBy: string; category: string; expenseDate: string }): string {
  return [c.submittedBy, c.category.replace(/_/g, " "), c.expenseDate].filter(Boolean).join(" - ");
}
