import { NextResponse } from "next/server";
import { getExpenseService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const claims = await getExpenseService().listDeletedClaims();
    return NextResponse.json({ claims });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
