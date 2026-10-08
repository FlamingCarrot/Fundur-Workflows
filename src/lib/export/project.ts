import type { Db } from "@/lib/db";
import { isInProject } from "@/lib/storage/blob";
import { getWorkflow } from "@/lib/workflow";
import {
  ExportError,
  validateArchive,
  pathFor,
  type ArchiveFile,
  type ProjectArchive,
} from "./archive";
/** One database statement gives a consistent metadata snapshot; file contents are immutable version paths. */
export async function collectProjectArchive(
  db: Db,
  workspaceId: string,
  slug: string,
): Promise<ProjectArchive> {
  const child = (table: string, order = "t.created_at,t.id") =>
    `COALESCE((SELECT jsonb_agg(to_jsonb(t)-ARRAY['workspace_id','project_id','created_by','updated_by','user_id'] ORDER BY ${order}) FROM ${table} t WHERE t.workspace_id=p.workspace_id AND t.project_id=p.id),'[]'::jsonb)`;
  const [row] = await db.query<{
    project_id: string;
    snapshot: Record<string, unknown>;
    files: {
      document_id: string;
      version: number;
      name: string;
      phase: string;
      size_bytes: string | number;
      current: boolean;
      file_location: string;
    }[];
  }>(
    `SELECT p.id AS project_id,jsonb_build_object(
 'project',jsonb_build_object('id',p.slug,'name',p.name,'client',p.client_name,'workflowId',p.workflow_id,'workflowVersion',p.workflow_version,'status',p.status,'waitingOn',p.waiting_on,'startDate',p.start_date,'currentPhase',p.current_phase_key,'completedPhases',p.completed_phases,'checks',p.checks,'brief',p.brief,'briefAiFields',p.brief_ai_fields,'phaseDates',p.phase_dates,'regulations',p.regulations),
 'documents',COALESCE((SELECT jsonb_agg(to_jsonb(d)-ARRAY['workspace_id','project_id','file_location'] ORDER BY d.created_at,d.id) FROM documents d WHERE d.workspace_id=p.workspace_id AND d.project_id=p.id),'[]'::jsonb),
 'documentVersions',COALESCE((SELECT jsonb_agg(to_jsonb(v)-ARRAY['workspace_id','file_location','created_by'] ORDER BY v.document_id,v.version_number) FROM document_versions v JOIN documents d ON d.id=v.document_id AND d.workspace_id=v.workspace_id WHERE d.workspace_id=p.workspace_id AND d.project_id=p.id),'[]'::jsonb),
 'tasks',${child("project_tasks")},'phaseSnapshots',${child("project_snapshots")},
 'floorPlans',${child("floor_plans", "t.updated_at")},'planVersions',${child("floor_plan_versions")},'planCorrections',${child("floor_plan_corrections")},
 'design',${child("project_design", "t.updated_at")},'chatMessages',${child("ai_chat_messages")},'aiProposals',${child("ai_proposals")},
 'records',${child("records")},'phaseInstances',${child("phase_instances")},'legacyTasks',${child("tasks")},
 'moduleData',COALESCE((SELECT jsonb_agg(to_jsonb(m)-ARRAY['workspace_id'] ORDER BY m.id) FROM module_data m JOIN phase_instances i ON i.id=m.phase_instance_id AND i.workspace_id=m.workspace_id WHERE i.project_id=p.id AND m.workspace_id=p.workspace_id),'[]'::jsonb)
 ) AS snapshot,
 COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.document_id,f.version) FROM (
 SELECT DISTINCT ON(document_id,version) * FROM (
 SELECT d.id AS document_id,d.version_number AS version,d.name,COALESCE(d.phase_key,'unassigned') AS phase,d.size_bytes,TRUE AS current,0 AS source_rank,d.file_location FROM documents d WHERE d.workspace_id=p.workspace_id AND d.project_id=p.id
 UNION ALL
 SELECT d.id AS document_id,v.version_number AS version,COALESCE(v.name,d.name) AS name,COALESCE(d.phase_key,'unassigned') AS phase,v.size_bytes,v.version_number=d.version_number AS current,1 AS source_rank,v.file_location FROM document_versions v JOIN documents d ON d.id=v.document_id AND d.workspace_id=v.workspace_id WHERE d.workspace_id=p.workspace_id AND d.project_id=p.id
 ) versions ORDER BY document_id,version,source_rank
 ) f),'[]'::jsonb) AS files FROM projects p WHERE p.workspace_id=$1 AND p.slug=$2`,
    [workspaceId, slug],
  );
  if (!row) throw new ExportError("Project not found", 404);
  const files: ArchiveFile[] = row.files.map((f) => ({
    documentId: f.document_id,
    version: f.version,
    name: f.name,
    phase: f.phase,
    sizeBytes: Number(f.size_bytes),
    current: f.current,
    storageKey: f.file_location,
    path: "",
  }));
  for (const f of files) {
    if (f.storageKey && !isInProject(f.storageKey, workspaceId, row.project_id))
      throw new ExportError("A document has an invalid storage reference.");
    f.path = pathFor(f);
  }
  const project = row.snapshot.project as {
    name: string;
    workflowId: string;
    workflowVersion: number;
  };
  const archive = {
    takenAt: new Date().toISOString(),
    projectName: project.name,
    slug,
    data: { ...row.snapshot, workflow: getWorkflow(project) },
    files,
  };
  validateArchive(archive);
  return archive;
}
