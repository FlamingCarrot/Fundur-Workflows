-- ==============================================================================
-- The autopilot: an agent per project that drives it through its workflow.
--
-- project_autopilot: whether it is on for a project, paused, how often it
-- looks, how much it may do (levels for the project, per phase and per step),
-- who it acts as, and when it last ran and runs next. running_since is a lock
-- so two triggers at once never run it twice.
--
-- autopilot_runs: one row per run, with what triggered it, what it did and the
-- chat message that holds its words and changes (each with Undo).
--
-- autopilot_asks: what it needs from the designer: a question, a choice, a
-- file, an approval, or a client update to send. Her answer is read by the
-- next run, which marks it used.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS project_autopilot (
    project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    paused BOOLEAN NOT NULL DEFAULT FALSE,
    cadence VARCHAR(20) NOT NULL DEFAULT 'daily', -- 'twice_daily' | 'daily' | 'weekly' | 'manual'
    settings JSONB NOT NULL DEFAULT '{}',
    run_as VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    last_run_at TIMESTAMP WITH TIME ZONE,
    next_run_at TIMESTAMP WITH TIME ZONE,
    next_reason TEXT,
    running_since TIMESTAMP WITH TIME ZONE,
    updated_by VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_autopilot_due ON project_autopilot(next_run_at) WHERE enabled AND NOT paused;

CREATE TABLE IF NOT EXISTS autopilot_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(255),
    trigger VARCHAR(20) NOT NULL, -- 'manual' | 'answer' | 'schedule' | 'visit'
    status VARCHAR(20) NOT NULL DEFAULT 'running', -- 'running' | 'done' | 'idle' | 'failed'
    summary TEXT NOT NULL DEFAULT '',
    message_id UUID REFERENCES ai_chat_messages(id) ON DELETE SET NULL,
    applied INTEGER NOT NULL DEFAULT 0,
    review INTEGER NOT NULL DEFAULT 0,
    asked INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_autopilot_runs_project ON autopilot_runs(project_id, started_at DESC);

CREATE TABLE IF NOT EXISTS autopilot_asks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    run_id UUID REFERENCES autopilot_runs(id) ON DELETE SET NULL,
    kind VARCHAR(20) NOT NULL, -- 'question' | 'choice' | 'file' | 'approval' | 'message'
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
    detail TEXT NOT NULL DEFAULT '',
    options JSONB NOT NULL DEFAULT '[]',
    -- For a client update: the text to send.
    draft TEXT,
    phase_key VARCHAR(100),
    step_item_id VARCHAR(100),
    urgent BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'open', -- 'open' | 'answered' | 'dismissed'
    answer TEXT,
    answer_files JSONB NOT NULL DEFAULT '[]',
    answered_by VARCHAR(255),
    answered_at TIMESTAMP WITH TIME ZONE,
    -- Set when a run has read the answer.
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_autopilot_asks_open ON autopilot_asks(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autopilot_asks_project ON autopilot_asks(project_id, status);
