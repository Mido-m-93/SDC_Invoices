
// POST /api/invoices/send-to-mf
import { NextRequest, NextResponse } from "next/server";
import { MoneyForwardService } from "@/lib/services/real/MoneyForwardService";
import { deriveDueDate } from "@/lib/services/real/SupabaseReminderService";
import { getDriveService, getStorageService } from "@/lib/services";
import { detectCurrency } from "@/lib/utils";
import type { InvoiceSubmission, InvoiceValidationResult } from "@/types";

export const dynamic = 'force-dynamic';

interface RequestBody {
  submission: InvoiceSubmission;
  validation: InvoiceValidationResult;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { submission, validation } = body as Partial<RequestBody>;

  if (!submission || !validation) {
    return NextResponse.json(
      { error: "Provide 'submission' and 'validation' in body" },
      { status: 400 }
    );
  }

  try {
    // Parse billing date from closingMonth (YYYY-MM â†’ YYYY-MM-01 as fallback)
    const billingDate = parseBillingDate(submission.closingMonth);

    // Parse amount â€” strip currency symbols, commas, spaces
    const amount = parseAmount(submission.claimedAmountTaxIncluded);

    // Fetch the PDF from Drive (optional â€” attach if available)
    let pdfData: Uint8Array | undefined;
    let pdfFilename: string | undefined;

    if (submission.invoiceAttachment) {
      try {
        const driveSvc    = getDriveService();
        const attachment  = await driveSvc.fetchAttachment(submission.invoiceAttachment);
        if (attachment) {
          pdfData     = attachment.data;
          pdfFilename = attachment.filename;
        }
      } catch (driveErr) {
        // PDF fetch failure is non-fatal â€” we still register the invoice in MF
        console.warn("[send-to-mf] Could not fetch PDF from Drive:", driveErr);
      }
    }

    const partnerName = (submission.payerName || submission.externalProjectName || submission.internalDepartment || "Unknown").trim() || "Unknown";
    const currency  = detectCurrency(submission.claimedAmountTaxIncluded) as "JPY" | "USD";

    // MF requires due_date unless the partner has a payment-deadline setting
    // configured on their MF profile — most partners created via this API
    // won't have one, so always derive it ourselves (same rule the Reminders
    // feature uses: end of closingMonth + paymentTermsDays). MF also rejects
    // due_date <= billing_date, so when closingMonth can't be parsed, fall
    // back to billingDate + paymentTermsDays rather than billingDate itself
    // (which would submit an equal date and fail the same validation).
    const paymentTermsDays = parseInt(process.env.PAYMENT_TERMS_DAYS ?? "30");
    const derivedDueDate   = deriveDueDate(submission.closingMonth, paymentTermsDays);
    const dueDate = derivedDueDate && derivedDueDate > billingDate
      ? derivedDueDate
      : addDays(billingDate, paymentTermsDays);

    const mfService = new MoneyForwardService();
    const result    = await mfService.sendInvoice({
      partnerName,
      title:       buildTitle(submission),
      billingDate,
      dueDate,
      amount,
      currency,
      memo: [
        submission.externalProjectName || submission.internalDepartment,
        submission.notes,
      ]
        .filter(Boolean)
        .join(" / "),
      pdfData,
      pdfFilename,
    });

    // Store MF billing info back to Supabase
    try {
      const storage = getStorageService();
      const [existing] = await storage.loadValidationResults([submission.id]);
      if (existing) {
        await storage.saveValidationResult({
          ...existing,
          mfBillingId: result.billingId,
          mfBillingUrl: result.billingUrl,
          mfSentAt: new Date().toISOString(),
        });
      }
    } catch (storeErr) {
      console.warn("[send-to-mf] Could not store MF billing info:", storeErr);
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = String(err);
    console.error("[POST /api/invoices/send-to-mf]", err);

    if (message.includes("MF_ACCESS_TOKEN not set")) {
      return NextResponse.json(
        { error: "Money Forward not connected — no token found", detail: message },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to send to Money Forward",
        detail: message,
        debug: {
          payerName: submission.payerName,
          externalProject: submission.externalProjectName,
          department: submission.internalDepartment,
        },
      },
      { status: 500 }
    );
  }
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildTitle(s: InvoiceSubmission): string {
  const project = s.externalProjectName || s.internalDepartment || s.projectType || "";
  const month   = s.closingMonth || "";
  return [s.payerName, project, month].filter(Boolean).join(" - ");
}

function parseBillingDate(closingMonth: string): string {
  if (!closingMonth) return new Date().toISOString().slice(0, 10);

  // ISO "2024-03" or "2024-03-31"
  const isoMatch = closingMonth.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (isoMatch) {
    return isoMatch[3]
      ? `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
      : `${isoMatch[1]}-${isoMatch[2]}-01`;
  }

  // Japanese "2024å¹´3æœˆ" or "2024å¹´3æœˆ31æ—¥"
  const jpMatch = closingMonth.match(/(\d{4})å¹´(\d{1,2})æœˆ(?:(\d{1,2})æ—¥)?/);
  if (jpMatch) {
    const y = jpMatch[1];
    const m = jpMatch[2].padStart(2, "0");
    const d = jpMatch[3] ? jpMatch[3].padStart(2, "0") : "01";
    return `${y}-${m}-${d}`;
  }

  return new Date().toISOString().slice(0, 10);
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[Â¥,ï¼Œ\så††]/g, "").replace(/[^\d.]/g, "");
  const parsed  = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}
