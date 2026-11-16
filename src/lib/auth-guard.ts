import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readAuthz, type Authz } from "@/lib/authz";
import { canSeeTab } from "@/lib/navTabs";

type AuthedUser = { id: string; email: string; role: string | undefined };
type GuardResult =
  | { user: AuthedUser; response: null }
  | { user: null; response: NextResponse };

async function resolveAuth(): Promise<
  | { user: AuthedUser; authz: Authz; response: null }
  | { user: null; authz: null; response: NextResponse }
> {
  // Dev / mock mode — Supabase not configured, skip auth
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return {
      user: { id: "dev", email: "dev@local", role: "admin" },
      authz: { role: "admin", isAdmin: true, allowedTabs: null, isPending: false },
      response: null,
    };
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
      authz: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const authz = readAuthz(user);
  if (authz.isPending) {
    return {
      user: null,
      authz: null,
      response: NextResponse.json({ error: "Account pending approval" }, { status: 403 }),
    };
  }
  return { user: { id: user.id, email: user.email ?? user.id, role: authz.role }, authz, response: null };
}

export async function requireAuth(): Promise<GuardResult> {
  const { user, response } = await resolveAuth();
  return user ? { user, response: null } : { user: null, response: response! };
}

/**
 * Like requireAuth(), but also requires access to a sidebar tab: admins always,
 * Members only if the tab is permitted for them (grant-only tabs need an
 * explicit grant). Hiding the nav link alone doesn't protect the API.
 */
export async function requireTabAccess(href: string): Promise<GuardResult> {
  const { user, authz, response } = await resolveAuth();
  if (!user) return { user: null, response: response! };
  if (!canSeeTab(href, authz.allowedTabs, authz.isAdmin)) {
    return {
      user: null,
      response: NextResponse.json({ error: "You don't have access to this page" }, { status: 403 }),
    };
  }
  return { user, response: null };
}

/** Like requireAuth(), but also requires the "admin" role in app_metadata. */
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
