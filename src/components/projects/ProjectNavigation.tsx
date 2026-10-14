"use client";

import React from "react";
import Link from "next/link";
import { Link2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { DesignLink } from "@/components/design/DesignLink";
import { GlobalProcessStepper } from "./GlobalProcessStepper";
import { ProjectSectionDropdown } from "./ProjectSectionDropdown";
import type { Project } from "@/lib/studio/types";
import "./project-work.css";

export { GlobalProcessStepper } from "./GlobalProcessStepper";
export { ProjectSectionDropdown } from "./ProjectSectionDropdown";

export function ClientLinksButton({
  project,
  beforeNavigate,
  compact = false,
}: {
  project: Project;
  beforeNavigate?: () => Promise<boolean>;
  compact?: boolean;
}) {
  const { viewer } = useStudio();
  const canShare =
    viewer.features?.sharing !== false &&
    (!viewer.workspaceRole ||
      ["owner", "member"].includes(viewer.workspaceRole));

  if (!canShare) return null;

  const sharingHref = `/projects/${project.id}/documents#sharing-heading`;
  const content = (
    <>
      <Link2 size={13} />
      {!compact && <span>Client links</span>}
    </>
  );

  return beforeNavigate ? (
    <DesignLink
      flush={beforeNavigate}
      href={sharingHref}
      className="btn-client-share"
      title="Client share links"
      aria-label="Client share links"
    >
      {content}
    </DesignLink>
  ) : (
    <Link
      href={sharingHref}
      className="btn-client-share"
      title="Client share links"
      aria-label="Client share links"
    >
      {content}
    </Link>
  );
}

export function ProjectNavigation({
  project,
  beforeNavigate,
  compact = false,
}: {
  project: Project;
  beforeNavigate?: () => Promise<boolean>;
  compact?: boolean;
}) {
  const { viewer } = useStudio();
  const canShare =
    viewer.features?.sharing !== false &&
    (!viewer.workspaceRole ||
      ["owner", "member"].includes(viewer.workspaceRole));

  return (
    <div className={`project-nav-wrapper${compact ? " compact" : ""}`}>
      <div className="project-nav-bar">
        <ProjectSectionDropdown
          project={project}
          beforeNavigate={beforeNavigate}
          compact={compact}
        />
        <GlobalProcessStepper
          project={project}
          beforeNavigate={beforeNavigate}
          compact={compact}
        />
        {canShare && (
          <ClientLinksButton
            project={project}
            beforeNavigate={beforeNavigate}
            compact={compact}
          />
        )}
      </div>
    </div>
  );
}
