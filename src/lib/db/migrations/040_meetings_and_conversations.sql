-- ==============================================================================
-- Meetings and conversations: every project gets channels with threaded posts,
-- mentions and files, video calls that can be recorded and transcribed, and the
-- notes taken from them. All of it stays with the project so the assistant can
-- read it and carry the work on.
--
-- Channels are the team space's chats grown up: project_chats gains a
-- description, whether invited clients see it, and a default flag (the
-- "Everyone" chat). Posts are project_chat_messages; a reply points at its post.
--
-- Meetings: a call with a room, joined by teammates and invited clients. Peers
-- are the browser tabs in a call; signals carry their WebRTC handshakes when
-- the built-in call service is used. A recording is never started without
-- telling everyone: each person's answer is kept in meeting_consents. Transcript
-- lines come from live captions, a transcribed recording or an uploaded file.
--
-- notifications: mentions, replies and meetings for teammates, read in Inbox.
-- ==============================================================================

ALTER TABLE project_chats ADD COLUMN IF NOT EXISTS description VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE project_chats ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) NOT NULL DEFAULT 'team' CHECK (visibility IN ('team', 'client'));
ALTER TABLE project_chats ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE project_chats ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE;

-- More than one channel can be open to everyone now, so only the default one is unique.
UPDATE project_chats SET is_default = TRUE WHERE cardinality(member_ids) = 0;
DROP INDEX IF EXISTS idx_project_chats_everyone;
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_chats_default ON project_chats(project_id) WHERE is_default;

ALTER TABLE project_chat_messages ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES project_chat_messages(id) ON DELETE CASCADE;
ALTER TABLE project_chat_messages ADD COLUMN IF NOT EXISTS author_kind VARCHAR(10) NOT NULL DEFAULT 'team' CHECK (author_kind IN ('team', 'client', 'assistant', 'system'));
ALTER TABLE project_chat_messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]';
ALTER TABLE project_chat_messages ADD COLUMN IF NOT EXISTS mentions TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE project_chat_messages ADD COLUMN IF NOT EXISTS meeting_id UUID;
ALTER TABLE project_chat_messages ADD COLUMN IF NOT EXISTS reply_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE project_chat_messages ADD COLUMN IF NOT EXISTS last_reply_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE project_chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE;
-- A post can be only files, so the body may be empty now.
ALTER TABLE project_chat_messages DROP CONSTRAINT IF EXISTS project_chat_messages_body_check;
ALTER TABLE project_chat_messages ADD CONSTRAINT project_chat_messages_body_check CHECK (length(body) <= 5000);
CREATE INDEX IF NOT EXISTS idx_chat_messages_parent ON project_chat_messages(parent_id, created_at) WHERE parent_id IS NOT NULL;

-- Where each person has read up to in each channel, for unread counts.
CREATE TABLE IF NOT EXISTS project_chat_reads (
    chat_id UUID NOT NULL REFERENCES project_chats(id) ON DELETE CASCADE,
    person_key VARCHAR(320) NOT NULL,
    read_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chat_id, person_key)
);

CREATE TABLE IF NOT EXISTS meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    agenda TEXT NOT NULL DEFAULT '',
    starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_min INTEGER NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 600),
    status VARCHAR(12) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
    provider VARCHAR(20) NOT NULL DEFAULT 'builtin',
    room VARCHAR(64) NOT NULL UNIQUE,
    client_visible BOOLEAN NOT NULL DEFAULT FALSE,
    chat_id UUID REFERENCES project_chats(id) ON DELETE SET NULL,
    post_id UUID REFERENCES project_chat_messages(id) ON DELETE SET NULL,
    recording_state VARCHAR(10) NOT NULL DEFAULT 'off' CHECK (recording_state IN ('off', 'on')),
    recording_by VARCHAR(320),
    captions BOOLEAN NOT NULL DEFAULT FALSE,
    notes JSONB,
    notes_source VARCHAR(10),
    notes_at TIMESTAMP WITH TIME ZONE,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_meetings_project ON meetings(workspace_id, project_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_meetings_when ON meetings(workspace_id, starts_at);

CREATE TABLE IF NOT EXISTS meeting_peers (
    id UUID PRIMARY KEY,
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    person_key VARCHAR(320) NOT NULL,
    name VARCHAR(255) NOT NULL,
    kind VARCHAR(10) NOT NULL CHECK (kind IN ('team', 'client')),
    state JSONB NOT NULL DEFAULT '{}',
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    left_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_meeting_peers_meeting ON meeting_peers(meeting_id, last_seen_at);

CREATE TABLE IF NOT EXISTS meeting_signals (
    id BIGSERIAL PRIMARY KEY,
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    from_peer UUID NOT NULL,
    to_peer UUID NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meeting_signals_to ON meeting_signals(to_peer, id);

-- Everyone's answer when a recording or transcript was started: kept as the record of consent.
CREATE TABLE IF NOT EXISTS meeting_consents (
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    person_key VARCHAR(320) NOT NULL,
    name VARCHAR(255) NOT NULL,
    decision VARCHAR(10) NOT NULL CHECK (decision IN ('given', 'declined')),
    decided_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (meeting_id, person_key)
);

CREATE TABLE IF NOT EXISTS meeting_recordings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL,
    name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL DEFAULT 'audio/webm',
    size_bytes BIGINT NOT NULL DEFAULT 0,
    duration_sec INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(12) NOT NULL DEFAULT 'saved' CHECK (status IN ('saved', 'transcribing', 'transcribed', 'failed')),
    error VARCHAR(500),
    created_by VARCHAR(320) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meeting_recordings_meeting ON meeting_recordings(meeting_id, created_at);

CREATE TABLE IF NOT EXISTS meeting_transcript_lines (
    id BIGSERIAL PRIMARY KEY,
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    speaker VARCHAR(255) NOT NULL,
    person_key VARCHAR(320),
    at_ms INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 5000),
    source VARCHAR(10) NOT NULL CHECK (source IN ('live', 'recording', 'upload')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transcript_lines_meeting ON meeting_transcript_lines(meeting_id, source, at_ms, id);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL,
    title VARCHAR(300) NOT NULL,
    body VARCHAR(500) NOT NULL DEFAULT '',
    href VARCHAR(500) NOT NULL,
    actor_name VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, workspace_id, created_at DESC);
