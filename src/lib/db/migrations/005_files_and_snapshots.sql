-- ==============================================================================
-- Files in object storage (P1-10) and snapshots with restore (P1-11).
--
-- documents.file_location is the file's path in object storage ('' when only
-- the name was recorded, as before storage existed). Every version of a file,
-- the current one included, is a row in document_versions; restoring an old
-- version adds a new version with its content, so history is never rewritten.
--
-- Completing a phase records a project snapshot: the brief as it stood and the
-- version of every document at that moment.
-- ==============================================================================

ALTER TABLE documents ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_type VARCHAR(255);

ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS size_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_document_versions_document ON document_versions(document_id, version_number);

CREATE TABLE IF NOT EXISTS project_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase_key VARCHAR(100) NOT NULL,
    trigger_event VARCHAR(100) NOT NULL DEFAULT 'phase_complete',
    brief JSONB NOT NULL DEFAULT '{}',
    brief_ai_fields TEXT[] NOT NULL DEFAULT '{}',
    -- [{ "id": document id, "version": version number }] at the time of the snapshot
    documents JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_snapshots_project ON project_snapshots(project_id, created_at);
