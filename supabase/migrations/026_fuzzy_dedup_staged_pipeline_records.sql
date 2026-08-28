-- Migration 025 deduped exact-text duplicates. But Notion/SharePoint sync
-- extracts client/project names via an LLM call on every run, and re-running
-- the same source doesn't reproduce byte-identical text (a stray space, a
-- reworded suffix, full/half-width character differences) — those near-
-- duplicates survived 025's exact match. runPipelineSync() now dedups
-- fuzzily going forward (see pipelineSyncService.ts matchExistingRecords);
-- this is a one-time cleanup pass for the near-duplicates that slipped
-- through before that fix, using Postgres trigram similarity as a stand-in
-- for the app's own fuzzy scorer.
--
-- For each pair of same-source, still-open (needs_review/auto_linked) rows
-- whose client name AND project name are both similar, keeps the newer row
-- and drops the older one.

create extension if not exists pg_trgm;

delete from staged_pipeline_records older
using staged_pipeline_records newer
where older.status in ('needs_review', 'auto_linked')
  and newer.status in ('needs_review', 'auto_linked')
  and older.source = newer.source
  and older.id <> newer.id
  and older.created_at < newer.created_at
  and similarity(older.raw_client_name, newer.raw_client_name) > 0.5
  and similarity(older.project_name, newer.project_name) > 0.5;
