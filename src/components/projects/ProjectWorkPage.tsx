"use client";
import type { ReactNode } from "react";
import { swatchVar } from "@/components/ui/primitives";
import { useStudioNavigationGuard } from "@/components/shell/StudioNavigation";
import type { Project } from "@/lib/studio/types";
import { ProjectNavigation } from "./ProjectNavigation";
export function ProjectWorkPage({
  project,
  title,
  description,
  actions,
  beforeNavigate,
  children,
  className = "",
}: {
  project: Project;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  beforeNavigate?: () => Promise<boolean>;
  children: ReactNode;
  className?: string;
}) {
  useStudioNavigationGuard(beforeNavigate);
  return (
    <main
      className={`page project-work-page ${className}`}
      style={swatchVar(project.swatch)}
    >
      <p className="eyebrow project-work-name">{project.name}</p>
      <ProjectNavigation project={project} beforeNavigate={beforeNavigate} />
      <header className="project-work-header">
        <div>
          <h1 className="display-m">{title}</h1>
          <p className="muted">{description}</p>
        </div>
        {actions && (
          <div className="row wrap project-work-actions">{actions}</div>
        )}
      </header>
      {children}
    </main>
  );
}
