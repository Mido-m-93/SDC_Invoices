// scripts/migrate-phase7.mjs
// Run: node scripts/migrate-phase7.mjs
// Creates reminder_logs table and extends app_config for Phase 7.

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env.local") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  console.log("Phase 7 migration starting…\n");

  // 1. Create reminder_logs table
  console.log("Creating reminder_logs table…");
  const { error: createErr } = await supabase.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS reminder_logs (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        reminder_type     text NOT NULL,
        target_month      text NOT NULL,
        vendor_id         uuid,
        submission_id     uuid,
        contract_id       uuid,
        sent_at           timestamptz NOT NULL DEFAULT now(),
        channel           text NOT NULL DEFAULT 'mock',
        status            text NOT NULL DEFAULT 'sent',
        message           text NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_reminder_logs_month ON reminder_logs(target_month);
      CREATE INDEX IF NOT EXISTS idx_reminder_logs_type  ON reminder_logs(reminder_type);
    `,
  });

  if (createErr) {
    // Supabase free-tier may not expose exec_sql — fallback message
    console.warn(
      "⚠  exec_sql RPC not available. Run this SQL manually in Supabase SQL Editor:\n"
    );
    console.log(`
CREATE TABLE IF NOT EXISTS reminder_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_type     text NOT NULL,
  target_month      text NOT NULL,
  vendor_id         uuid,
  submission_id     uuid,
  contract_id       uuid,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  channel           text NOT NULL DEFAULT 'mock',
  status            text NOT NULL DEFAULT 'sent',
  message           text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_month ON reminder_logs(target_month);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_type  ON reminder_logs(reminder_type);

-- Extend app_config with Phase 7 columns (safe to run multiple times)
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS teams_webhook_url          text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS stale_review_threshold_days int    DEFAULT 3,
  ADD COLUMN IF NOT EXISTS due_date_threshold_days     int    DEFAULT 5,
  ADD COLUMN IF NOT EXISTS escalation_recipient        text   DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_terms_days          int    DEFAULT 30;
`);
  } else {
    console.log("✓ reminder_logs table ready");

    // 2. Extend app_config
    console.log("Extending app_config with Phase 7 columns…");
    await supabase.rpc("exec_sql", {
      sql: `
        ALTER TABLE app_config
          ADD COLUMN IF NOT EXISTS teams_webhook_url          text DEFAULT '',
          ADD COLUMN IF NOT EXISTS stale_review_threshold_days int  DEFAULT 3,
          ADD COLUMN IF NOT EXISTS due_date_threshold_days     int  DEFAULT 5,
          ADD COLUMN IF NOT EXISTS escalation_recipient        text DEFAULT '',
          ADD COLUMN IF NOT EXISTS payment_terms_days          int  DEFAULT 30;
      `,
    });
    console.log("✓ app_config extended");
  }

  // 3. Verify reminder_logs exists by inserting + deleting a test row
  console.log("\nVerifying reminder_logs is accessible…");
  const { error: insertErr } = await supabase.from("reminder_logs").insert({
    reminder_type: "missing_invoice",
    target_month: "2000-01",
    channel: "mock",
    status: "skipped",
    message: "migration test row",
  });

  if (insertErr) {
    console.error("✗ Cannot write to reminder_logs:", insertErr.message);
    console.log(
      "\nIf the table does not exist yet, run the SQL above in Supabase SQL Editor first."
    );
    process.exit(1);
  }

  // Clean up test row
  await supabase
    .from("reminder_logs")
    .delete()
    .eq("target_month", "2000-01");

  console.log("✓ reminder_logs is writable");
  console.log("\n✅ Phase 7 migration complete.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
