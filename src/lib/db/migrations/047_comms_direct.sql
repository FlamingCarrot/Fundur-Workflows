-- Direct messages: a private conversation between two people on a project,
-- kept as a channel of exactly those two.
ALTER TABLE project_chats ADD COLUMN IF NOT EXISTS is_direct BOOLEAN NOT NULL DEFAULT FALSE;
