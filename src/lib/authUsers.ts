// src/lib/authUsers.ts
// Shared helpers for listing/archiving Supabase Auth accounts (the "Users"
// page under System) — separate from the co-op's business "Members" entity.

import "server-only";
import { getSupabaseClient } from "@/lib/supabase";

export interface AppUser {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  isAdmin: boolean;
}

// A ban this long is effectively permanent until explicitly lifted — used as
// a reversible "archive" for an auth account instead of a real delete, since
// deleting a Supabase Auth user is irreversible.
export const ARCHIVE_BAN_DURATION = "876000h";

export async function listAllAuthUsers(): Promise<AppUser[]> {
  const db = getSupabaseClient();
  const users: AppUser[] = [];
  const perPage = 200;

  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);

    for (const u of data.users) {
      const metadata = (u.user_metadata ?? {}) as { archived_at?: string; archived_by?: string; role?: string };
      users.push({
        id: u.id,
        email: u.email ?? "",
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        archivedAt: u.banned_until ? metadata.archived_at ?? u.banned_until : null,
        archivedBy: u.banned_until ? metadata.archived_by ?? null : null,
        isAdmin: metadata.role === "admin",
      });
    }

    if (data.users.length < perPage) break;
  }

  return users;
}

/** True if at least one account currently has the admin role — used to gate one-time bootstrap. */
export async function anyAdminExists(): Promise<boolean> {
  const users = await listAllAuthUsers();
  return users.some((u) => u.isAdmin);
}
