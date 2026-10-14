-- Conversations: what a web address in a post shows (title, description,
-- site), read once from the public page and kept for a week.
CREATE TABLE IF NOT EXISTS project_chat_link_previews (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    ok BOOLEAN NOT NULL,
    title VARCHAR(300),
    description VARCHAR(600),
    site VARCHAR(200),
    image TEXT,
    fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, url)
);
