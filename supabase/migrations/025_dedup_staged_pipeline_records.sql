-- runPipelineSync() staged a brand-new record on every sync run with no
-- check for whether that client/project was already staged, so repeated
-- clicks of "Run Notion Sync" / "Run SharePoint Sync" piled up duplicate
-- needs_review rows for the same pipeline item. The app now dedups by
-- (source, client, project) going forward — this is a one-time cleanup of
-- the duplicates that already accumulated.
--
-- Keeps the most recently staged row per group; leaves approved/rejected
-- rows untouched since those already produced a lead (or were an explicit
-- human decision) and shouldn't be disturbed by a bulk cleanup.

delete from staged_pipeline_records
where id in (
  select id from (
    select id,
      row_number() over (
        partition by source, raw_client_name, project_name
        order by created_at desc
      ) as rn
    from staged_pipeline_records
    where status in ('needs_review', 'auto_linked')
  ) ranked
  where rn > 1
);
