
// src/app/api/runs/route.ts
import { NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const runs = await getStorageService().loadRuns();
    return NextResponse.json({ count: runs.length, runs });
  } catch (err) {
    console.error("[GET /api/runs]", err);
    return NextResponse.json(
      { error: "Failed to load runs", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    await getStorageService().clearAllRuns();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/runs]", err);
    return NextResponse.json(
      { error: "Failed to clear runs", detail: String(err) },
      { status: 500 }
    );
  }
}
