-- ==============================================================================
-- Issue reports as tickets (P1-18, P1-19).
--
-- A report is kept against the module it is about and, when made inside a
-- project, that project, so the reporter sees a marker where they left it.
-- The Admin works each report as a ticket: open, in_progress, resolved. The
-- reporter can edit their note or close it ('closed') when it no longer applies.
-- ==============================================================================

ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS admin_note TEXT NOT NULL DEFAULT '';
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_issue_reports_reporter ON issue_reports(user_id, status);
CREATE INDEX IF NOT EXISTS idx_issue_reports_queue ON issue_reports(status, created_at DESC);
