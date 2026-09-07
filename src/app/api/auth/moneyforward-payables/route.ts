
// GET /api/auth/moneyforward-payables — redirect to MF Cloud Payables OAuth authorization page
import { NextResponse } from "next/server";
import { buildMFPayablesAuthUrl } from "@/lib/services/real/MoneyForwardPayablesService";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = 'force-dynamic';

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  if (!process.env.MF_PAYABLES_CLIENT_ID || !process.env.MF_PAYABLES_REDIRECT_URI) {
    return NextResponse.json(
      { error: "MF_PAYABLES_CLIENT_ID and MF_PAYABLES_REDIRECT_URI must be set in .env.local" },
      { status: 500 }
    );
  }
  return NextResponse.redirect(buildMFPayablesAuthUrl());
}
