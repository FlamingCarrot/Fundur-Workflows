import type { Project } from "./types";
import type { Viewer } from "./viewer";
import { getWorkflow, label } from "@/lib/workflow";
import { parseModuleRef } from "@/lib/modules/registry";

export interface ProjectSection {
  href: string;
  label: string;
}

/** One menu for a project's pinned workflow, independent of the open screen. */
export function projectSections(
  project: Project,
  viewer: Viewer,
): ProjectSection[] {
  const base = `/projects/${project.id}`;
  const sections: ProjectSection[] = [
    { href: base, label: "Overview" },
    {
      href: `${base}/phases/${project.currentPhase}`,
      label: "Phases and completion",
    },
  ];
  const design = viewer.features?.design !== false;
  const ai =
    viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator";
  const practice =
    !viewer.workspaceRole || ["owner", "member"].includes(viewer.workspaceRole);
  const workflow = getWorkflow(project);
  const add = (path: string, name: string) => {
    const href = `${base}/${path}`;
    if (!sections.some((s) => s.href === href))
      sections.push({ href, label: name });
  };
  for (const phase of workflow.phases) {
    for (const ref of phase.modules) {
      const { key, variant } = parseModuleRef(ref);
      if (key === "structured_form" && variant)
        add(
          variant === "brief" ? "brief" : `forms/${variant}`,
          label(project, variant, variant === "brief" ? "Brief" : variant),
        );
      if (key === "notes")
        add(`forms/notes:${phase.key}`, `${phase.name} notes`);
      if (key === "floor_plan_editor" && viewer.features?.floor_plan !== false)
        add("plan", label(project, "floor_plan", "Floor plan"));
      if (
        key === "layout_generator" &&
        viewer.features?.layout !== false &&
        viewer.features?.floor_plan !== false
      )
        add("layout", label(project, "layout_generator", "Layout options"));
      if (!design) continue;
      if (key === "canvas_board" && variant)
        add(`boards/${variant}`, label(project, variant, "Board"));
      if (key === "item_register" && variant)
        add(`items/${variant}`, label(project, variant, "Items"));
      if (key === "regulatory_checklist")
        add("regulations", "Regulation checklist");
      if (key === "message_drafter") add("rfqs", "Quote requests");
    }
    if (
      design &&
      ai &&
      phase.ai_actions.some((a) => a.id === "generate_concept_visuals")
    )
      add("concepts", "Concept visuals");
  }
  add("documents", "Documents");
  if (ai && practice) add("ai", "AI spend");
  if (practice) {
    add("export", "Export project ZIP");
    if (design) add("templates", "Reusable setups");
  }
  return sections;
}

export function activeProjectSection(
  sections: ProjectSection[],
  pathname: string,
): string | undefined {
  // All phases belong to the same section; other routes require an exact match.
  return (
    sections.find((s) => s.href === pathname)?.href ??
    sections.find(
      (s) =>
        s.href.includes("/phases/") &&
        pathname.startsWith(s.href.split("/phases/")[0] + "/phases/"),
    )?.href
  );
}
