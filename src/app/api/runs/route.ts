
// src/app/api/runs/route.ts
import { NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";
import { requireAuth } from "@/lib/auth-guard";

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
  const { user, response } = await requireAuth();
  if (!user) return response!;
  try {
    await getStorageService().clearAllRuns(user.email);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/runs]", err);
    return NextResponse.json(
      { error: "Failed to clear runs", detail: String(err) },
      { status: 500 }
    );
  }
}
