import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { username } = await req.json() as { username: string };
    if (!username?.trim()) {
      return NextResponse.json({ error: "Username required" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from("profiles")
      .select("email")
      .eq("username", username.trim().toLowerCase())
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Username not found" }, { status: 404 });
    }

    return NextResponse.json({ email: data.email });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
