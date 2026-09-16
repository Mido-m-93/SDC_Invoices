import { NextResponse } from "next/server";
import { getContractService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    const contracts = await getContractService().listDeletedContracts();
    return NextResponse.json({ contracts });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
