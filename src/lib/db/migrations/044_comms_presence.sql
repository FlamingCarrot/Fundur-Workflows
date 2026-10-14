-- Conversations: who has seen a channel (shown as "Seen by"), who is typing
-- right now, and channels a person has muted. All per person, per channel.
ALTER TABLE project_chat_reads ADD COLUMN IF NOT EXISTS person_name TEXT;
ALTER TABLE project_chat_reads ADD COLUMN IF NOT EXISTS typing_at TIMESTAMPTZ;
ALTER TABLE project_chat_reads ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE;
