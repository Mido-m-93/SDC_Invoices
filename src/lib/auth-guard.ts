import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function requireAuth(): Promise<
  | { user: { id: string; email: string; role: string | undefined }; response: null }
  | { user: null; response: NextResponse }
> {
  // Dev / mock mode — Supabase not configured, skip auth
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { user: { id: "dev", email: "dev@local", role: "admin" }, response: null };
  }

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      user: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const role = (user.user_metadata as { role?: string } | undefined)?.role;
  return { user: { id: user.id, email: user.email ?? user.id, role }, response: null };
}

/** Like requireAuth(), but also requires the "admin" role in user_metadata. */
export async function requireAdmin(): Promise<
  | { user: { id: string; email: string; role: string | undefined }; response: null }
  | { user: null; response: NextResponse }
> {
  const result = await requireAuth();
  if (!result.user) return result;
  if (result.user.role !== "admin") {
    return {
      user: null,
      response: NextResponse.json({ error: "Admin access required" }, { status: 403 }),
    };
  }
  return result;
}
