// scripts/clear-supabase.mjs
// Deletes all rows from every invoice-related table in Supabase.
// app_config is intentionally left untouched.
//
// Usage:
//   node scripts/clear-supabase.mjs

import { readFileSync } from "fs";

// ── Load .env.local ───────────────────────────────────────────────────────────
const envPath = decodeURIComponent(
  new URL("../.env.local", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")
);
const envText = readFileSync(envPath, "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const SUPABASE_URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !KEY) {
  console.error("❌  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}

const headers = {
  "apikey": KEY,
  "Authorization": `Bearer ${KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=minimal",
};

// DELETE via PostgREST: DELETE /rest/v1/<table>?pk=neq.impossible
// Each entry: [tableName, pkColumn]
const TABLES = [
  ["processing_logs",     "id"],
  ["filed_documents",     "submission_id"],
  ["invoice_validations", "submission_id"],
  ["processing_runs",     "id"],
  ["invoice_submissions", "id"],
];

console.log("⚠️  This will DELETE ALL ROWS from the following tables:");
TABLES.forEach(([t]) => console.log(`   • ${t}`));
console.log("   (app_config is NOT touched)\n");

let allOk = true;
for (const [table, pk] of TABLES) {
  // PostgREST filter: pk=neq.________never________ — matches every real row
  const url = `${SUPABASE_URL}/rest/v1/${table}?${pk}=neq.________never________`;
  const res = await fetch(url, { method: "DELETE", headers });
  if (!res.ok) {
    const body = await res.text();
    console.error(`❌  ${table}: HTTP ${res.status} — ${body}`);
    allOk = false;
  } else {
    console.log(`✓  ${table}: cleared`);
  }
}

console.log(allOk ? "\n✅  Done. Supabase is clean." : "\n⚠️  Some tables had errors — check output above.");
