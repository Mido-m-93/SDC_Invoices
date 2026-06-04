// scripts/set-teams-webhook.mjs — saves Teams webhook URL to app_config
import { readFileSync } from "fs";

const envPath = decodeURIComponent(
  new URL("../.env.local", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")
);
const envText = readFileSync(envPath, "utf8");
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).map((l) => {
    const idx = l.indexOf("=");
    return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, "")];
  })
);

const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_URL = process.argv[2];

if (!SUPABASE_URL || !KEY) { console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
if (!WEBHOOK_URL) { console.error("Usage: node scripts/set-teams-webhook.mjs <webhook-url>"); process.exit(1); }

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const res = await fetch(`${SUPABASE_URL}/rest/v1/app_config?id=eq.main`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ teams_webhook_url: WEBHOOK_URL }),
});

if (res.ok) {
  console.log("✅ Teams webhook URL saved to app_config");
} else {
  const err = await res.text();
  console.error("❌ Failed:", err);
}
