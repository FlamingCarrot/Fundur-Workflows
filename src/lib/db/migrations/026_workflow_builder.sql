CREATE TABLE workflow_builder_settings (
 workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 audience VARCHAR(20) NOT NULL DEFAULT 'admin' CHECK(audience IN ('admin','owners')),
 monthly_cap_zar NUMERIC(12,2) NOT NULL DEFAULT 150 CHECK(monthly_cap_zar BETWEEN 0 AND 10000),
 updated_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE workflow_builds (
 id UUID PRIMARY KEY,
 workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
 mode VARCHAR(20) NOT NULL CHECK(mode IN ('interview','generate')),
 input JSONB NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK(status IN ('running','ready','failed')),
 result JSONB,
 error TEXT,
 accepted_workflow_id VARCHAR(100) REFERENCES workflows(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_workflow_builds_running ON workflow_builds(workspace_id) WHERE status='running';
CREATE INDEX idx_workflow_builds_workspace ON workflow_builds(workspace_id,created_at DESC);
CREATE TABLE workflow_capability_requests (
 id UUID PRIMARY KEY,
 workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 build_id UUID NOT NULL REFERENCES workflow_builds(id) ON DELETE CASCADE,
 capability TEXT NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK(status IN ('open','planned','delivered','dismissed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
