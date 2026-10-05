// src/app/api/expenses/[id]/receipt-file — streams a claim's saved receipt
// back from the "expense-receipts" Storage bucket. Kept behind our own auth
// check rather than a signed Storage URL, so access always matches whoever
// can already see expense claims in the app.
import { NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { getSupabaseClient } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth-guard";
import { sniffMimeFromUrl } from "@/lib/services/real/SupabaseExpenseService";

export const dynamic = "force-dynamic";

const RECEIPTS_BUCKET = "expense-receipts";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  const svc = getExpenseService();
  const claim = await svc.getClaim(params.id);
  if (!claim?.filedStoragePath) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = getSupabaseClient();
  const { data, error } = await db.storage.from(RECEIPTS_BUCKET).download(claim.filedStoragePath);
  if (error || !data) {
    return NextResponse.json({ error: "Could not read saved receipt", detail: error ? JSON.stringify(error) : undefined }, { status: 500 });
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": sniffMimeFromUrl(claim.filedStoragePath),
      "Content-Disposition": `inline; filename="${claim.filedStoragePath.split("/").pop()}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
