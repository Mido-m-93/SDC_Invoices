// src/lib/authz.ts
// Single source of truth for reading a Supabase user's authorization.
// Authorization lives ONLY in app_metadata, which only the service role can
// write. Never read it from user_metadata — any signed-in user can edit their
// own user_metadata via supabase.auth.updateUser().

type AuthUserLike = { app_metadata?: Record<string, unknown> | null } | null | undefined;

export interface Authz {
  role: string | undefined;
  isAdmin: boolean;
  /** `null` = unrestricted; an array names the only tab hrefs this user can see. */
  allowedTabs: string[] | null;
  /** True unless app_metadata.approval === "approved". Admins are never pending. */
  isPending: boolean;
}

export function readAuthz(user: AuthUserLike): Authz {
  const meta = user?.app_metadata ?? {};
  const role = typeof meta.role === "string" ? meta.role : undefined;
  const allowedTabs = Array.isArray(meta.allowedTabs) ? (meta.allowedTabs as string[]) : null;
  const isAdmin = role === "admin";
  // Fail closed: only an explicit "approved" (or admin) gets in. A missing flag
  // means a new sign-up — or a flag lost somewhere — and is treated as pending.
  return { role, isAdmin, allowedTabs, isPending: !isAdmin && meta.approval !== "approved" };
}

export const PENDING_PATH = "/pending";

/** Where middleware should send a signed-in user, or null to let the request through. */
export function pendingRedirect(pathname: string, isPending: boolean): string | null {
  if (isPending) {
    return pathname === PENDING_PATH || pathname.startsWith("/auth/") ? null : PENDING_PATH;
  }
  return pathname === PENDING_PATH ? "/dashboard" : null;
}
