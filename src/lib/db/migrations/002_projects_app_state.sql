-- ==============================================================================
-- Projects as the app runs them.
--
-- A project row carries what every screen reads: its phase position, checklist
-- ticks, brief and AI marks. The workflow it runs is named by id and version,
-- because definitions ship with the code (src/lib/workflow/definitions) rather
-- than living in workflow_versions yet. URLs use a slug that is unique within a
-- workspace, so two studios can both have a "harbour-house".
-- ==============================================================================

ALTER TABLE projects ALTER COLUMN workflow_version_id DROP NOT NULL;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug VARCHAR(100);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS swatch VARCHAR(20) NOT NULL DEFAULT 'clay';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS workflow_id VARCHAR(100);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS workflow_version INTEGER;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS completed_phases TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS checks JSONB NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS brief JSONB NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS brief_ai_fields TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_spend_zar NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- Nothing wrote projects before this migration, so these hold for every row.
ALTER TABLE projects ALTER COLUMN slug SET NOT NULL;
ALTER TABLE projects ALTER COLUMN workflow_id SET NOT NULL;
ALTER TABLE projects ALTER COLUMN workflow_version SET NOT NULL;
ALTER TABLE projects ALTER COLUMN start_date SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_workspace_slug ON projects(workspace_id, slug);

-- Documents are listed per project and phase. Phase instances are not stored
-- yet, so a document names its phase by key.
ALTER TABLE documents ALTER COLUMN phase_instance_id DROP NOT NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS phase_key VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);

-- Auth0 does not always share an email (some social sign-ins), and one person
-- can reach Auth0 through two connections with the same email. The Auth0 user
-- id is the identity; email is only for display.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
