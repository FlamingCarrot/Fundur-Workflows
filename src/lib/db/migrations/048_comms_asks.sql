-- A post can ask for a decision: approve or not, or choose between options.
-- Everyone who can see the post (clients too) picks one; the latest pick counts.
ALTER TABLE project_chat_messages ADD COLUMN IF NOT EXISTS ask JSONB;
