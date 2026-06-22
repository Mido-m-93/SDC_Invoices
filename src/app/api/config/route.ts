// src/app/api/config/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStorageService } from "@/lib/services";
import type { AppConfig } from "@/types";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await getStorageService().loadConfig();
    return NextResponse.json(config);
  } catch (err) {
    console.error("[GET /api/config]", err);
    return NextResponse.json(
      { error: "Failed to load config", detail: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  let config: AppConfig;
  try {
    config = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    await getStorageService().saveConfig(config);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[POST /api/config]", err);
    return NextResponse.json(
      { error: "Failed to save config", detail: String(err) },
      { status: 500 }
    );
  }
}
