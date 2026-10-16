"use client";
import { useStudio } from "@/components/providers/StudioProvider";
import { useLibrary } from "@/components/library/LibraryContext";
import { BlueprintEditor } from "@/components/library/BlueprintEditor";
import { MissingProject } from "@/components/views/MissingProject";
import { WhenReady } from "@/components/ui/primitives";
import { canUseTool } from "@/lib/team/access";
import "./asset-modeler.css";

export function AssetModeler({ projectId, assetId }: { projectId: string; assetId: string }) {
  const { ready, getProject, viewer } = useStudio();
  const library = useLibrary();
  const project = getProject(projectId);
  const asset = library.library.blueprints.find(b => b.id === assetId && b.gameAsset?.projectId === projectId);
  const readOnly = project?.myAccess?.level === "view" || viewer.workspaceRole === "collaborator" || viewer.workspaceRole === "client";
  return <WhenReady ready={ready && library.status !== "loading"}>{project && asset && canUseTool(project.myAccess, "assets")
    ? <BlueprintEditor key={assetId} id={assetId} blueprint={asset} assetMode readOnly={readOnly} initialTab={readOnly ? "outliner" : "sculpt"} backHref={`/projects/${projectId}/assets`} />
    : <main className="page"><MissingProject /></main>}</WhenReady>;
}
