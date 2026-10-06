-- ==============================================================================
-- Phase dates moved on the timeline (P2-06).
--
-- The workflow says when each phase runs, counted from the start of the
-- project. A phase moved on the timeline is kept here as the day it now starts;
-- everything inside it moves with it. A phase that was never moved is absent.
-- ==============================================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS phase_dates JSONB NOT NULL DEFAULT '{}';
