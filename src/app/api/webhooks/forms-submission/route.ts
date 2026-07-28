// POST /api/webhooks/forms-submission
//
// Root-cause fix for Microsoft's Nov 2024 change to Forms→Excel sync: new
// responses now only get written into the linked Excel file once someone
// opens it in Excel Online — there's no API call that forces that flush.
// This endpoint bypasses the Excel file entirely: a Power Automate flow
// triggered directly off "when a new Forms response is submitted" posts the
// response straight here, and it's saved straight to Supabase. No Excel,
// no sync lag, no manual opening.
import { NextRequest, NextResponse } from "next/server";
import { generateId, parseSnapshotMonth } from "@/lib/utils";
import { getStorageService } from "@/lib/services";
import { buildFieldMap } from "@/lib/services/formFieldMapping";
import type { InvoiceSubmission } from "@/types";

export const dynamic = 'force-dynamic';

interface WebhookBody {
  fields?: Record<string, string>;
  submittedAt?: string;
}

export async function POST(req: NextRequest) {
  const secret = process.env.FORMS_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "FORMS_WEBHOOK_SECRET not configured on the server" },
      { status: 500 }
    );
  }
  if (req.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.fields || typeof body.fields !== "object") {
    return NextResponse.json(
      { error: "Provide 'fields': a map of Form question title -> answer text" },
      { status: 400 }
    );
  }

  try {
    const headers = Object.keys(body.fields);
    const fieldMap = buildFieldMap(headers);
    const get = (key: string): string => {
      for (const [header, field] of Array.from(fieldMap)) {
        if (field !== key) continue;
        return (body.fields![header] ?? "").toString().trim();
      }
      return "";
    };

    const submission: InvoiceSubmission = {
      id: generateId(),
      // Negative and unique — never collides with real Excel row numbers
      // (always >= 2), which is all this field is used to disambiguate.
      submissionRowNumber:      -Date.now(),
      submittedAt:               body.submittedAt || new Date().toISOString(),
      email:                     get("email"),
      payerName:                 get("payerName"),
      closingMonth:              get("closingMonth"),
      invoiceAttachment:         get("invoiceAttachment"),
      notes:                     get("notes"),
      internalDepartment:        get("internalDepartment"),
      externalProjectName:       get("externalProjectName"),
      projectType:               get("projectType"),
      claimedAmountTaxIncluded:  get("claimedAmountTaxIncluded"),
      currency:                  get("currency") || undefined,
      invoiceProjectStatus:      "",
      paymentStatus:             "",
      paymentAmount:             "",
      paymentProcessingStatus:   "",
    };

    if (!submission.payerName) {
      return NextResponse.json(
        {
          error: "Could not find a 'Name' field in the submitted fields",
          detail: "Check that the JSON body's keys match the Form's question titles exactly.",
          receivedKeys: headers,
        },
        { status: 400 }
      );
    }

    const month = parseSnapshotMonth(submission.closingMonth);
    if (month === "unknown") {
      return NextResponse.json(
        {
          error: "Could not determine the closing month from the submitted fields",
          detail: `closingMonth value was: "${submission.closingMonth}"`,
        },
        { status: 400 }
      );
    }

    const stored = await getStorageService().loadSubmissionsFromStore(month);
    await getStorageService().saveSubmissions([...stored, submission], month);

    return NextResponse.json({ ok: true, id: submission.id, month }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/webhooks/forms-submission]", err);
    return NextResponse.json(
      { error: "Failed to save submission", detail: String(err) },
      { status: 500 }
    );
  }
}
