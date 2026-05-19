import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        global: {
          // Disable Next.js fetch caching so every Supabase read always
          // returns fresh data instead of a stale cached response.
          fetch: (url: RequestInfo | URL, options: RequestInit = {}) =>
            fetch(url, { ...options, cache: "no-store" }),
        },
      }
    );
  }
  return _client;
}
