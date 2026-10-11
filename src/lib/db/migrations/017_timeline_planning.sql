-- ==============================================================================
-- Planning on the timeline.
--
-- A task can run over several days (start_date to due_date), wait on other
-- tasks (depends_on: ids of steps or of tasks of their own), be a milestone,
-- and carry an estimate of hours for the workload view. A project can keep the
-- plan as it stood on a day (baseline) to see what slipped since.
-- ==============================================================================

ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS depends_on JSONB NOT NULL DEFAULT '[]';
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS milestone BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS estimate_hours NUMERIC(7, 2);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS baseline JSONB;
