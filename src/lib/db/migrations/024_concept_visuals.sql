ALTER TABLE model_settings ADD COLUMN image_usd_per_image NUMERIC(12,6);
CREATE TABLE concept_generations (
 id UUID PRIMARY KEY,
 workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 created_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
 input JSONB NOT NULL,
 source JSONB NOT NULL,
 results JSONB NOT NULL DEFAULT '[]'::jsonb,
 status TEXT NOT NULL CHECK(status IN ('running','complete','partial','failed')),
 error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_one_concept_generation_running ON concept_generations(project_id) WHERE status='running';
CREATE INDEX idx_concept_generations_workspace ON concept_generations(workspace_id,project_id,created_at DESC);
