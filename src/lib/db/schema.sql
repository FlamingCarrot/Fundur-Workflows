-- ==============================================================================
-- Fundur Workflows: Core Postgres Schema for Neon Database
-- Multi-tenant by design (every record carries workspace isolation)
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. WORKSPACES
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    settings JSONB NOT NULL DEFAULT '{"autosave": true, "realtime_sync": true}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. USERS
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY, -- Auth0 user ID (e.g. auth0|123456)
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255),
    avatar_url TEXT,
    platform_role VARCHAR(50) NOT NULL DEFAULT 'user', -- 'admin' | 'user'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. MEMBERSHIPS
CREATE TABLE IF NOT EXISTS memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member', -- 'owner' | 'member' | 'collaborator'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

-- 4. WORKFLOWS (Template definitions)
CREATE TABLE IF NOT EXISTS workflows (
    id VARCHAR(100) PRIMARY KEY, -- e.g. 'interior-design-corporate', 'ux-design'
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE, -- NULL for platform built-ins
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'published', -- 'draft' | 'published' | 'archived'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. WORKFLOW VERSIONS (Frozen immutable editions of a workflow)
CREATE TABLE IF NOT EXISTS workflow_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id VARCHAR(100) NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    definition JSONB NOT NULL, -- Full structured schema: phases, modules, checklists, forms, AI actions
    published_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(workflow_id, version_number)
);

-- 6. PROJECTS (Running instances of a workflow)
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    workflow_version_id UUID NOT NULL REFERENCES workflow_versions(id),
    name VARCHAR(255) NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active' | 'on_hold' | 'complete' | 'archived'
    waiting_on VARCHAR(50) NOT NULL DEFAULT 'me', -- 'me' | 'client' (waiting on someone else)
    current_phase_key VARCHAR(100) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. PHASE INSTANCES (State of each phase in a running project)
CREATE TABLE IF NOT EXISTS phase_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    order_index INTEGER NOT NULL,
    state VARCHAR(50) NOT NULL DEFAULT 'not_started', -- 'not_started' | 'active' | 'completed'
    completed_at TIMESTAMP WITH TIME ZONE,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(project_id, key)
);

-- 8. TASKS & CHECKLIST ITEMS (Real-time synced step tasks)
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase_instance_id UUID NOT NULL REFERENCES phase_instances(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    due_date TIMESTAMP WITH TIME ZONE,
    source VARCHAR(50) NOT NULL DEFAULT 'system', -- 'system' (from workflow checklist) | 'manual'
    is_essential BOOLEAN NOT NULL DEFAULT FALSE,
    done BOOLEAN NOT NULL DEFAULT FALSE,
    output_doc_id UUID,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. DOCUMENTS (Files, briefs, schedules, uploads)
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase_instance_id UUID NOT NULL REFERENCES phase_instances(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL, -- 'pdf', 'image', 'dwg', 'doc', 'brief'
    file_location TEXT NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    client_visible BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. DOCUMENT VERSIONS (Snapshots taken on phase complete or share)
CREATE TABLE IF NOT EXISTS document_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    file_location TEXT NOT NULL,
    trigger_event VARCHAR(100) NOT NULL, -- 'manual' | 'phase_complete' | 'share'
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(document_id, version_number)
);

-- 11. RECORDS (Generic structured project records, e.g. brief fields, FF&E items, suppliers)
CREATE TABLE IF NOT EXISTS records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    record_type VARCHAR(100) NOT NULL, -- e.g. 'brief', 'ffe_item', 'supplier'
    field_values JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. MODULE DATA (Phase module state storage: floor plans, layout options, canvas boards)
CREATE TABLE IF NOT EXISTS module_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phase_instance_id UUID NOT NULL REFERENCES phase_instances(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    module_key VARCHAR(100) NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(phase_instance_id, module_key)
);

-- 13. SHARE LINKS (White-labeled client view tokens)
CREATE TABLE IF NOT EXISTS share_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    token VARCHAR(128) NOT NULL UNIQUE,
    target_type VARCHAR(50) NOT NULL, -- 'document' | 'version' | 'phase'
    target_id UUID NOT NULL,
    mode VARCHAR(50) NOT NULL DEFAULT 'snapshot', -- 'live' | 'snapshot'
    permission VARCHAR(50) NOT NULL DEFAULT 'view', -- 'view' | 'comment' | 'edit'
    expires_at TIMESTAMP WITH TIME ZONE,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    view_count INTEGER NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 14. AI RUNS (Token and cost logging)
CREATE TABLE IF NOT EXISTS ai_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase_instance_id UUID REFERENCES phase_instances(id) ON DELETE SET NULL,
    task_name VARCHAR(255) NOT NULL,
    model_name VARCHAR(100) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0.000000,
    outcome VARCHAR(50) NOT NULL DEFAULT 'success', -- 'success' | 'failed' | 'retrying'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 15. PROVIDER KEYS (Encrypted at rest on server)
CREATE TABLE IF NOT EXISTS provider_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE, -- NULL for platform keys
    provider VARCHAR(100) NOT NULL, -- 'openrouter' | 'anthropic' | 'openai' | 'gemini'
    encrypted_key TEXT NOT NULL,
    verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(workspace_id, provider)
);

-- 16. ISSUE REPORTS (In-app feedback pinned to specific modules)
CREATE TABLE IF NOT EXISTS issue_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module_key VARCHAR(100) NOT NULL,
    page_url TEXT NOT NULL,
    note TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'open', -- 'open' | 'in_progress' | 'resolved'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 17. FEATURE FLAGS
CREATE TABLE IF NOT EXISTS feature_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) NOT NULL,
    scope VARCHAR(50) NOT NULL DEFAULT 'platform', -- 'platform' | 'workspace' | 'user'
    scope_id VARCHAR(255),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(key, scope, scope_id)
);

-- Indexes for lightning fast real-time queries
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_phase_instances_project ON phase_instances(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks(phase_instance_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_phase ON documents(phase_instance_id);
CREATE INDEX IF NOT EXISTS idx_records_project ON records(project_id, record_type);
CREATE INDEX IF NOT EXISTS idx_ai_runs_project ON ai_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);
