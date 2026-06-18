-- Core invoice processing tables (initial schema)
-- These tables power the main invoice upload, validation, and filing workflow.

-- ── Invoice Submissions ───────────────────────────────────────────────────────
create table if not exists invoice_submissions (
  id                          text primary key,
  snapshot_month              text not null,
  submission_row_number       integer not null,
  email                       text not null default '',
  payer_name                  text not null default '',
  closing_month               text not null default '',
  invoice_attachment          text not null default '',
  notes                       text not null default '',
  internal_department         text not null default '',
  external_project_name       text not null default '',
  project_type                text not null default '',
  claimed_amount_tax_included text not null default '',
  invoice_project_status      text not null default '',
  payment_status              text not null default '',
  payment_amount              text not null default '',
  payment_processing_status   text not null default '',
  created_at                  timestamptz not null default now()
);
create index if not exists invoice_submissions_month_idx      on invoice_submissions (snapshot_month);
create index if not exists invoice_submissions_row_idx        on invoice_submissions (snapshot_month, submission_row_number);

-- ── Invoice Validations ───────────────────────────────────────────────────────
create table if not exists invoice_validations (
  submission_id           text primary key references invoice_submissions (id) on delete cascade,
  pdf_accessible          boolean not null default false,
  invoice_date_found      boolean not null default false,
  tax_included            boolean not null default false,
  subtotal_found          boolean not null default false,
  total_found             boolean not null default false,
  amount_consistent       boolean not null default false,
  amount_matches_sheet    boolean not null default false,
  duplicate_detected      boolean not null default false,
  status_code             text not null default '',
  issues                  text[] not null default '{}',
  extracted_fields        jsonb,
  proposed_filename       text not null default '',
  target_folder_path      text not null default '',
  human_approved          boolean,
  risk_level              text,
  reviewer_recommendation text,
  vendor_matched          boolean,
  contract_matched        boolean,
  contract_id             text,
  validated_by            text,
  approved_by             text,
  updated_at              timestamptz not null default now()
);
create index if not exists invoice_validations_status_idx on invoice_validations (status_code);

-- ── Filed Documents ───────────────────────────────────────────────────────────
create table if not exists filed_documents (
  submission_id     text primary key references invoice_submissions (id) on delete cascade,
  original_filename text not null default '',
  new_filename      text not null default '',
  drive_folder_id   text not null default '',
  drive_file_id     text not null default '',
  drive_web_view_link text not null default '',
  saved_at          timestamptz not null default now()
);

-- ── Processing Runs ───────────────────────────────────────────────────────────
create table if not exists processing_runs (
  id            text primary key,
  month         text not null,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  total_rows    integer not null default 0,
  ready         integer not null default 0,
  review_required integer not null default 0,
  saved         integer not null default 0,
  errors        integer not null default 0,
  status        text not null default 'running'
);
create index if not exists processing_runs_month_idx on processing_runs (month);

-- ── Processing Logs ───────────────────────────────────────────────────────────
create table if not exists processing_logs (
  id            text primary key,
  run_id        text not null references processing_runs (id) on delete cascade,
  submission_id text not null default '',
  step          text not null default '',
  result        text not null default '',
  message       text not null default '',
  timestamp     timestamptz not null default now()
);
create index if not exists processing_logs_run_idx on processing_logs (run_id);

-- ── App Config ────────────────────────────────────────────────────────────────
create table if not exists app_config (
  id                          text primary key default 'main',
  completed_statuses          text[] not null default '{"支払済"}',
  skip_statuses               text[] not null default '{}',
  month_folder_naming_mode    text not null default 'YYYY-MM',
  month_folder_custom_template text not null default '',
  filename_rule               text not null default '{payerName}_{closingMonth}_{originalFilename}',
  default_language            text not null default 'ja',
  duplicate_detection_mode    text not null default 'filename',
  amount_tolerance_absolute   numeric not null default 1,
  teams_webhook_url           text not null default '',
  stale_review_threshold_days integer not null default 3,
  due_date_threshold_days     integer not null default 5,
  escalation_recipient        text not null default '',
  payment_terms_days          integer not null default 30,
  updated_at                  timestamptz not null default now()
);

-- Insert default config row so loadConfig() always returns something
insert into app_config (id) values ('main') on conflict (id) do nothing;
