// POST /api/expenses/[id]/send-to-mf
import { NextRequest, NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { MoneyForwardService } from "@/lib/services/real/MoneyForwardService";
import { convertUsdToJpy } from "@/lib/services/real/ExchangeRateService";
import { downloadSharePointFile } from "@/lib/services/real/SharePointContractService";

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

    // MF requires due_date unless the partner has a payment-deadline setting
    // configured — fresh partners never do, so always supply one.
    const paymentTermsDays = parseInt(process.env.PAYMENT_TERMS_DAYS ?? "30");
    const dueDate = addDays(claim.expenseDate, paymentTermsDays);

    // MoneyForward has no currency field at all — convert USD to JPY
    // ourselves using the day's ECB reference rate, noting the original
    // amount + rate in the memo for audit trail.
    let mfAmount = claim.amount;
    let fxNote: string | null = null;
    if (claim.currency === "USD") {
      const { amountJpy, rate, asOf } = await convertUsdToJpy(claim.amount, claim.expenseDate);
      mfAmount = amountJpy;
      fxNote = `Converted from $${claim.amount.toFixed(2)} @ ¥${rate}/$ (rate as of ${asOf})`;
    }

    const mfService = new MoneyForwardService();
    const result = await mfService.sendInvoice({
      partnerName: claim.submittedBy,
      title: buildTitle(claim),
      billingDate: claim.expenseDate,
      dueDate,
      amount: mfAmount,
      currency: "JPY",
      memo: [claim.description, fxNote].filter(Boolean).join(" / "),
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
