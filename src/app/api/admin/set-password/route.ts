import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// One-time admin endpoint to set a user's password via service role.
// Protected by CRON_SECRET header. Remove this file after use.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-admin-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { email, password } = await req.json() as { email: string; password: string };
  if (!email || !password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: user } = await supabase.auth.admin.listUsers();
  const target = user?.users?.find((u) => u.email === email);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const { error } = await supabase.auth.admin.updateUserById(target.id, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
