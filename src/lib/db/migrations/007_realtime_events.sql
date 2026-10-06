-- ==============================================================================
-- A shared channel for live sync.
--
-- The in-memory bus only reaches people served by the same instance, so on
-- Vercel two people usually miss each other. Events are written here instead,
-- and each open stream reads the rows added since it last looked. Rows are
-- short-lived: they are a channel, not a record.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS realtime_events (
    id BIGSERIAL PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    -- The project as the app addresses it (its slug), so a stream needs no lookup.
    project_slug VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    phase_key VARCHAR(100),
    -- The browser tab that sent it, so it can ignore its own echo.
    origin VARCHAR(100),
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_realtime_events_channel ON realtime_events(workspace_id, project_slug, id);
CREATE INDEX IF NOT EXISTS idx_realtime_events_created ON realtime_events(created_at);
