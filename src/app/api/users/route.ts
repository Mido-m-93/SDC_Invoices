// src/app/api/users/route.ts
// GET /api/users
// Lists everyone who has created a Supabase Auth account for this app
// (distinct from the co-op's business "Members" entity).

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { getSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface AppUser {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
}

export async function GET() {
  const { user, response } = await requireAuth();
  if (!user) return response!;

  try {
    const db = getSupabaseClient();
    const users: AppUser[] = [];
    const perPage = 200;

    for (let page = 1; page <= 10; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(error.message);

      for (const u of data.users) {
        users.push({
          id: u.id,
          email: u.email ?? "",
          createdAt: u.created_at,
          lastSignInAt: u.last_sign_in_at ?? null,
        });
      }

      if (data.users.length < perPage) break;
    }

    users.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json({ count: users.length, users });
  } catch (err) {
    console.error("[GET /api/users]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
