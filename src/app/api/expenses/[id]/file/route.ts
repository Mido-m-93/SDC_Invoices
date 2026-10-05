// src/app/api/expenses/[id]/file/route.ts
// POST /api/expenses/:id/file — copies an approved expense's receipt into
// the "expense-receipts" Supabase Storage bucket, so it's archived in-app
// (shown on the Reports page) independent of the original SharePoint link
// or any Google Drive access.
import { NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { getSupabaseClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth-guard";
import { downloadSharePointFile } from "@/lib/services/real/SharePointContractService";
import { sniffMimeFromUrl } from "@/lib/services/real/SupabaseExpenseService";
import type { ExpenseClaim } from "@/types";

export const dynamic = "force-dynamic";

const RECEIPTS_BUCKET = "expense-receipts";

function buildReceiptFilename(claim: ExpenseClaim): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").trim();
  const original = claim.receiptFilename || "receipt";
  const hasExt = /\.[a-z0-9]{2,4}$/i.test(original);
  const ext = hasExt ? "" : sniffMimeFromUrl(claim.receiptUrl) === "application/pdf" ? ".pdf" : ".jpg";
  return `${safe(original)}${ext}`;
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  const svc = getExpenseService();
  const claim = await svc.getClaim(params.id);
  if (!claim) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (claim.status !== "approved") {
    return NextResponse.json(
      { error: "Cannot save receipt", reason: `Status is ${claim.status}. Only approved claims can be saved.` },
      { status: 422 }
    );
  }
  if (!claim.receiptUrl) {
    return NextResponse.json({ error: "Claim has no receipt to save" }, { status: 422 });
  }
  if (claim.filedStoragePath) {
    return NextResponse.json({ error: "Already saved", filedStoragePath: claim.filedStoragePath }, { status: 409 });
  }

  try {
    const data = await downloadSharePointFile(claim.receiptUrl);
    const mimeType = sniffMimeFromUrl(claim.receiptUrl);
    const storagePath = `${claim.id}/${buildReceiptFilename(claim)}`;

    const db = getSupabaseClient();
    const { error: uploadError } = await db.storage
      .from(RECEIPTS_BUCKET)
      .upload(storagePath, data, { upsert: true, contentType: mimeType });
    if (uploadError) throw new Error(JSON.stringify(uploadError));

    const filedAt = new Date().toISOString();
    await svc.saveClaim({
      ...claim,
      filedStoragePath: storagePath,
      filedAt,
      updatedAt: filedAt,
    });

    return NextResponse.json({ success: true, filedStoragePath: storagePath, filedAt });
  } catch (err) {
    console.error("[POST /api/expenses/[id]/file]", err);
    return NextResponse.json({ error: "Save failed", detail: String(err) }, { status: 500 });
  }
}
