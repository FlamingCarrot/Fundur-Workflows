"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Link2, ArrowLeft } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { DesignLink } from "@/components/design/DesignLink";
import { GlobalProcessStepper } from "./GlobalProcessStepper";
import { ProjectSectionDropdown } from "./ProjectSectionDropdown";
import type { Project } from "@/lib/studio/types";
import "./project-work.css";

export { GlobalProcessStepper } from "./GlobalProcessStepper";
export { ProjectSectionDropdown } from "./ProjectSectionDropdown";

export interface ProjectBackLink {
  href: string;
  label: string;
}

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
  backLink,
}: {
  project: Project;
  beforeNavigate?: () => Promise<boolean>;
  compact?: boolean;
  backLink?: ProjectBackLink | null;
}) {
  const { viewer } = useStudio();
  const pathname = usePathname();
  const router = useRouter();

  const canShare =
    viewer.features?.sharing !== false &&
    (!viewer.workspaceRole ||
      ["owner", "member"].includes(viewer.workspaceRole));

  let resolvedBackLink: ProjectBackLink | null = null;
  if (backLink !== undefined) {
    resolvedBackLink = backLink;
  } else {
    if (pathname === `/projects/${project.id}`) {
      resolvedBackLink = { href: "/projects", label: "All projects" };
    } else if (pathname.startsWith(`/projects/${project.id}`)) {
      resolvedBackLink = { href: `/projects/${project.id}`, label: project.name };
    }
  }

  const handleBackClick = async (e: React.MouseEvent) => {
    if (!resolvedBackLink) return;
    if (beforeNavigate) {
      e.preventDefault();
      const ok = await beforeNavigate();
      if (ok) router.push(resolvedBackLink.href);
    }
  };

  return (
    <div className={`project-nav-wrapper${compact ? " compact" : ""}`}>
      <div className="project-nav-bar">
        <div className="project-nav-top-row">
          <div className="project-nav-left">
            {resolvedBackLink && (
              <Link
                href={resolvedBackLink.href}
                onClick={handleBackClick}
                className="project-nav-back-btn"
                title={`Back to ${resolvedBackLink.label}`}
              >
                <ArrowLeft size={14} />
                <span className="truncate">{resolvedBackLink.label}</span>
              </Link>
            )}
            <ProjectSectionDropdown
              project={project}
              beforeNavigate={beforeNavigate}
              compact={compact}
            />
          </div>

          <div className="project-nav-right">
            {canShare && (
              <ClientLinksButton
                project={project}
                beforeNavigate={beforeNavigate}
                compact={false}
              />
            )}
          </div>
        </div>

        <div className="project-nav-stepper-row">
          <GlobalProcessStepper
            project={project}
            beforeNavigate={beforeNavigate}
            compact={false}
          />
        </div>
      </div>
    </div>
  );
}
