-- ==============================================================================
-- Phase 4, epics 4.3 to 4.6: model roles and fallback, key checks, task
-- routing with a review gate, project chat, cost per phase and task, and
-- per-project budget alerts.
-- ==============================================================================

-- Model roles (P4-09). The one default model becomes the orchestrator: the top
-- model the designer talks to, which also reviews worker output. 'worker' is
-- the cheap tier, and each tier may have a fallback used when its model fails.
UPDATE model_settings SET role = 'orchestrator'
WHERE workspace_id IS NULL AND role = 'default'
  AND NOT EXISTS (SELECT 1 FROM model_settings WHERE workspace_id IS NULL AND role = 'orchestrator');

-- The last check of each saved key (P4-07), so a card can say a key stopped working.
ALTER TABLE provider_keys ADD COLUMN IF NOT EXISTS checked_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE provider_keys ADD COLUMN IF NOT EXISTS check_error TEXT;

-- Each provider's model list, refreshed once a day (P4-08).
CREATE TABLE IF NOT EXISTS provider_model_lists (
    provider VARCHAR(100) PRIMARY KEY,
    models JSONB NOT NULL DEFAULT '[]',
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Which tier each kind of AI task runs on, and how often the review gate may
-- send work back (P4-13, P4-14). Task types without a row use their default.
CREATE TABLE IF NOT EXISTS ai_task_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE, -- NULL for the platform
    task_type VARCHAR(100) NOT NULL,
    tier VARCHAR(20) NOT NULL, -- 'top' | 'worker'
    max_retries INTEGER NOT NULL DEFAULT 2,
    updated_by VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_task_routes_platform ON ai_task_routes(task_type) WHERE workspace_id IS NULL;

-- The project chat (P4-10): one conversation per project.
CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(255),
    role VARCHAR(20) NOT NULL, -- 'user' | 'assistant'
    content TEXT NOT NULL DEFAULT '',
    -- Files dropped into the chat, and what the assistant did (tools run, work flagged).
    attachments JSONB NOT NULL DEFAULT '[]',
    events JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_project ON ai_chat_messages(project_id, created_at);

-- Changes the assistant proposes. Nothing changes until the designer confirms;
-- confirming applies the same project change a person makes.
CREATE TABLE IF NOT EXISTS ai_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    message_id UUID REFERENCES ai_chat_messages(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    mutation JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'applied' | 'dismissed'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_ai_proposals_message ON ai_proposals(message_id);

-- What each AI call was for (P4-15): its phase and task, the tier's role, the
-- review attempt, and whether a fallback model answered.
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS phase_key VARCHAR(100);
-- The task: a workflow step's checklist item id, or the id of a task of her own.
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS task_ref VARCHAR(100);
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS chat_message_id UUID REFERENCES ai_chat_messages(id) ON DELETE SET NULL;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'orchestrator';
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS fallback BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_ai_runs_chat_message ON ai_runs(chat_message_id) WHERE chat_message_id IS NOT NULL;

-- Runs from before phases were recorded count against the phase that holds the brief.
UPDATE ai_runs r SET phase_key = 'discovery'
FROM projects p
WHERE r.project_id = p.id AND r.phase_key IS NULL AND r.task_name = 'brief_draft'
  AND p.workflow_id = 'interior-design-corporate';

-- Per-project AI budget (P4-16).
CREATE TABLE IF NOT EXISTS project_ai_budgets (
    project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    budget_zar NUMERIC(12, 2) NOT NULL,
    -- An alert fires when spend crosses this share of the budget, and again at the budget.
    alert_percent INTEGER NOT NULL DEFAULT 80,
    -- Stop new AI calls on the project once the budget is used up.
    pause_at_limit BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_budget_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    level VARCHAR(20) NOT NULL, -- 'threshold' | 'limit'
    spend_zar NUMERIC(12, 4) NOT NULL,
    budget_zar NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    dismissed_at TIMESTAMP WITH TIME ZONE
);
-- One alert per level per budget: raising the budget lets them fire again.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_budget_alerts_once ON ai_budget_alerts(project_id, level, budget_zar);

-- The kind of document the assistant filed a file as, e.g. "Supplier quote" (P4-11).
-- Kept in documents.metadata->>'kind'; no column needed.
