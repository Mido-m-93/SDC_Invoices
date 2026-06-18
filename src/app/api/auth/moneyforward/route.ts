// GET /api/auth/moneyforward — redirect to MF OAuth authorization page
import { NextResponse } from "next/server";
import { buildMFAuthUrl } from "@/lib/services/real/MoneyForwardService";

export async function GET() {
  if (!process.env.MF_CLIENT_ID || !process.env.MF_REDIRECT_URI) {
    return NextResponse.json(
      { error: "MF_CLIENT_ID and MF_REDIRECT_URI must be set in .env.local" },
      { status: 500 }
    );
  }
  return NextResponse.redirect(buildMFAuthUrl());
}
