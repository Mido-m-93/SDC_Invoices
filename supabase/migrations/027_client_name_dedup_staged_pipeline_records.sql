-- Migration 026 required BOTH raw_client_name and project_name to be similar
-- before treating two staged rows as duplicates. That's the same flaw just
-- fixed in runPipelineSync()'s matching (pipelineSyncService.ts): a client's
-- name extracts consistently run to run, but the free-text project field
-- gets reworded by the LLM enough to fail a similarity bar on its own,
-- letting the same client restage as "new" almost every sync. This pass
-- dedups on client name alone, which is what let rows like "横河電機株式会社"
-- accumulate 4+ copies despite 026 already having run.
--
-- Keeps the newer row per fuzzy-matching client name; drops the rest.

create extension if not exists pg_trgm;

delete from staged_pipeline_records older
using staged_pipeline_records newer
where older.status in ('needs_review', 'auto_linked')
  and newer.status in ('needs_review', 'auto_linked')
  and older.source = newer.source
  and older.id <> newer.id
  and older.created_at < newer.created_at
  and similarity(older.raw_client_name, newer.raw_client_name) > 0.6;
