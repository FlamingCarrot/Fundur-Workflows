CREATE INDEX idx_search_project_name ON projects USING GIN(to_tsvector('english'::regconfig,name));
CREATE INDEX idx_search_project_client ON projects USING GIN(to_tsvector('english'::regconfig,COALESCE(client_name,'')));
CREATE INDEX idx_search_project_brief ON projects USING GIN(jsonb_to_tsvector('english'::regconfig,brief,'["string"]'::jsonb));
CREATE INDEX idx_search_project_forms ON projects USING GIN(jsonb_to_tsvector('english'::regconfig,form_values,'["string"]'::jsonb));
CREATE INDEX idx_search_document_name ON documents USING GIN(to_tsvector('english'::regconfig,name));
CREATE INDEX idx_search_task_title ON project_tasks USING GIN(to_tsvector('english'::regconfig,title));
