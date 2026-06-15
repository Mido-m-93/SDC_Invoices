"use client";

import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { useRouter } from "next/navigation";

export type AppUser = string;

const PALETTE = [
  "#8b5cf6", "#0ea5e9", "#f43f5e", "#f59e0b",
  "#10b981", "#6366f1", "#ec4899", "#14b8a6",
];

function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function useCurrentUser() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const resolveUser = (authUser: { user_metadata?: Record<string, unknown>; email?: string } | null) => {
      if (!authUser) return null;
      const username = authUser.user_metadata?.username as string | undefined;
      const name = authUser.user_metadata?.name as string | undefined;
      return username || name || authUser.email?.split("@")[0] || "User";
    };

    // getUser() hits the Supabase server and returns fresh database metadata,
    // bypassing the stale JWT cached in localStorage.
    supabase.auth.getUser().then(({ data: { user: authUser } }) => {
      setUser(resolveUser(authUser));
      setReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Skip INITIAL_SESSION — it carries the stale cached JWT.
      // getUser() above already handles the initial load with fresh server data.
      if (event === "INITIAL_SESSION") return;
      setUser(resolveUser(session?.user ?? null));
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return { user, ready, signOut };
}

export function userInitials(name: AppUser): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function userColor(name: AppUser): string {
  return nameToColor(name);
}
