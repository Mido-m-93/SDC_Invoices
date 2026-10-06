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
}

export function readAuthz(user: AuthUserLike): Authz {
  const meta = user?.app_metadata ?? {};
  const role = typeof meta.role === "string" ? meta.role : undefined;
  const allowedTabs = Array.isArray(meta.allowedTabs) ? (meta.allowedTabs as string[]) : null;
  return { role, isAdmin: role === "admin", allowedTabs };
}
