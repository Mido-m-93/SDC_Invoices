import { NextRequest, NextResponse } from "next/server";
import { getAccountingService } from "@/lib/services";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { actorName } = await req.json() as { actorName: string };
    await getAccountingService().postEntry(params.id, actorName ?? "system");
    return NextResponse.json({ success: true });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
