ALTER TABLE projects ADD COLUMN regulations JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE project_snapshots ADD COLUMN regulations JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE project_snapshots ADD COLUMN checks JSONB NOT NULL DEFAULT '{}'::jsonb;
UPDATE projects SET regulations = '{
  "reg-fire-egress": {"title":"Confirm the applicable fire escape and egress requirements","category":"fire_egress","notes":"Record the applicable requirements, drawing references and professional review here."},
  "reg-accessibility": {"title":"Confirm the applicable accessibility requirements","category":"accessibility","notes":"Record the applicable requirements, drawing references and professional review here."}
}'::jsonb
WHERE workflow_id = 'interior-design-corporate' AND NOT ('documentation' = ANY(completed_phases));
