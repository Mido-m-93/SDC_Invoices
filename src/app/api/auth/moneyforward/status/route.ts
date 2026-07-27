// GET /api/auth/moneyforward/status - diagnostic: shows token presence in Supabase
import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getSupabaseClient();
    const { data, error } = await db.rpc("get_mf_tokens");

    if (error) {
      return NextResponse.json({ error: JSON.stringify(error) }, { status: 500 });
    }

    const row = data as { mf_access_token?: string; mf_refresh_token?: string } | null;
    return NextResponse.json({
      rpcOk: true,
      mf_access_token:  row?.mf_access_token  ? `set (${row.mf_access_token.length} chars)` : "EMPTY",
      mf_refresh_token: row?.mf_refresh_token ? `set (${row.mf_refresh_token.length} chars)` : "EMPTY",
      env_MF_ACCESS_TOKEN: process.env.MF_ACCESS_TOKEN ? `set (${process.env.MF_ACCESS_TOKEN.length} chars)` : "EMPTY",
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
