// GET /api/auth/moneyforward/status - diagnostic: shows token presence in Supabase
import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db.storage.from("mf-config").download("tokens.json");

    if (error) {
      return NextResponse.json({
        storageError: JSON.stringify(error),
        supabase_url: process.env.SUPABASE_URL ?? "NOT SET",
        env_MF_ACCESS_TOKEN: process.env.MF_ACCESS_TOKEN ? "set" : "EMPTY",
      }, { status: 200 });
    }

    const tokens = JSON.parse(await data.text()) as { access?: string; refresh?: string };
    return NextResponse.json({
      storageOk: true,
      access_token:  tokens.access  ? `set (${tokens.access.length} chars)` : "EMPTY",
      refresh_token: tokens.refresh ? `set (${tokens.refresh.length} chars)` : "EMPTY",
      env_MF_ACCESS_TOKEN: process.env.MF_ACCESS_TOKEN ? `set (${process.env.MF_ACCESS_TOKEN.length} chars)` : "EMPTY",
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
