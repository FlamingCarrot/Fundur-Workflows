-- ==============================================================================
-- User management, the Admin / Basic view, and support requests.
--
-- users.status: 'active' can use the app; 'disabled' was switched off by the
-- Admin; 'waiting' signed up while sign-ups were invite only and waits for the
-- Admin to let them in. Everyone already here stays active.
--
-- users.view_mode: the Admin's own choice of seeing the app as Admin or as a
-- basic user. Kept per person so it is the same on every device.
--
-- invites: the Admin asks someone in by email. The invite is used up when that
-- person signs in with the address (verified), or opens the invite link.
--
-- issue_reports.kind: 'issue' is a report pinned to a part of the app (P1-18);
-- 'support' is a request for help, which is a conversation in ticket_messages.
-- Both are tickets in the Admin's queue.
-- ==============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS view_mode VARCHAR(20) NOT NULL DEFAULT 'admin';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_changed_by VARCHAR(255);

CREATE TABLE IF NOT EXISTS invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    platform_role VARCHAR(50) NOT NULL DEFAULT 'user',
    token VARCHAR(64) NOT NULL UNIQUE,
    invited_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    accepted_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(LOWER(email));

ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'issue';
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS subject VARCHAR(255);
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS topic VARCHAR(50);
-- When the reporter last read the conversation, so a new reply shows as unread.
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS reporter_seen_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,
    author_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    from_admin BOOLEAN NOT NULL DEFAULT FALSE,
    body TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id, created_at);

-- Who may sign up: anyone (the default, as before), or invited people only.
-- One row for the whole platform.
CREATE TABLE IF NOT EXISTS platform_access (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    invite_only BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
INSERT INTO platform_access (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
