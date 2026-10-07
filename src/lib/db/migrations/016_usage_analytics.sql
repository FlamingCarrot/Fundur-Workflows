-- ==============================================================================
-- Usage analytics and the improvement advisor.
--
-- Every page view, click, action and error people make in the app is kept
-- here, first-party, so the Admin can watch live, see heat maps, and have the
-- AI read the numbers and say what to improve next. Form values and typed
-- text are never recorded; a click keeps the element's label, not its value.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS usage_events (
    id BIGSERIAL PRIMARY KEY,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    user_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    -- So the Admin's own clicking can be left out of the numbers.
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    -- One browser tab's visit; a new one starts after 30 minutes idle.
    session_id VARCHAR(64) NOT NULL,
    -- page_view | page_leave | click | action | error | heartbeat
    type VARCHAR(32) NOT NULL,
    -- The page as visited, and the same page with its ids replaced (/projects/:project).
    path VARCHAR(500) NOT NULL DEFAULT '/',
    route VARCHAR(300) NOT NULL DEFAULT '/',
    -- What was clicked (its label) or done (the action's name), or the error message.
    target VARCHAR(300),
    -- Clicks: page coordinates in pixels, with the window size they were made at.
    x REAL,
    y REAL,
    viewport_w INTEGER,
    viewport_h INTEGER,
    device VARCHAR(16),
    -- page_leave: time on the page.
    duration_ms INTEGER,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_type ON usage_events(type, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_route ON usage_events(route, type, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_session ON usage_events(session_id, id);

-- What the Admin knows from outside the app: customer interviews, feedback,
-- competitor notes. The advisor reads these alongside the usage numbers.
CREATE TABLE IF NOT EXISTS research_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind VARCHAR(20) NOT NULL DEFAULT 'customer', -- 'customer' | 'competitor' | 'other'
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- One reading of the evidence by the AI, and the improvements it ranked.
CREATE TABLE IF NOT EXISTS advisor_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    summary TEXT NOT NULL DEFAULT '',
    period_days INTEGER NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}',
    model VARCHAR(200),
    cost_zar NUMERIC(12, 4) NOT NULL DEFAULT 0,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS advisor_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES advisor_runs(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    title VARCHAR(300) NOT NULL,
    why TEXT NOT NULL,
    evidence TEXT NOT NULL DEFAULT '',
    impact VARCHAR(10) NOT NULL DEFAULT 'medium', -- 'high' | 'medium' | 'low'
    effort VARCHAR(10) NOT NULL DEFAULT 'medium', -- 'small' | 'medium' | 'large'
    area VARCHAR(200) NOT NULL DEFAULT '',
    steps JSONB NOT NULL DEFAULT '[]',
    basis JSONB NOT NULL DEFAULT '[]',
    -- 'open' | 'doing' | 'done' | 'dismissed' | 'superseded' (a newer reading replaced it)
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    status_changed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_advisor_suggestions_status ON advisor_suggestions(status, created_at DESC);

-- The advisor's AI calls belong to the platform, not to a project.
ALTER TABLE ai_runs ALTER COLUMN project_id DROP NOT NULL;
