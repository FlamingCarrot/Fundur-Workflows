"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, Link2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { DesignLink } from "@/components/design/DesignLink";
import {
  activeProjectSection,
  projectSections,
} from "@/lib/studio/project-navigation";
import { getWorkflow } from "@/lib/workflow";
import { phaseState } from "@/lib/studio/selectors";
import type { Project } from "@/lib/studio/types";
import "./project-work.css";

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
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const sections = projectSections(project, viewer);
  const current = activeProjectSection(sections, pathname);
  const canShare =
    viewer.features?.sharing !== false &&
    (!viewer.workspaceRole ||
      ["owner", "member"].includes(viewer.workspaceRole));
  const sharingHref = `/projects/${project.id}/documents#sharing-heading`;
  return (
    <div className="project-navigation-container">
    <nav
      className={`project-navigation${compact ? " project-navigation-compact" : ""}`}
      aria-label="Project sections"
    >
      <div className="project-section-links">
        {sections.map((section) => {
          const props = {
            href: section.href,
            children: section.label,
            "aria-current":
              current === section.href ? ("page" as const) : undefined,
          };
          return beforeNavigate ? (
            <DesignLink key={section.href} {...props} flush={beforeNavigate} />
          ) : (
            <Link key={section.href} {...props} />
          );
        })}
      </div>
      <label className="project-section-picker">
        <span className="tiny muted">Project section</span>
        <select
          className="input"
          value={current ?? ""}
          disabled={busy}
          onChange={async (event) => {
            const href = event.target.value;
            setBusy(true);
            try {
              if (!beforeNavigate || (await beforeNavigate()))
                router.push(href);
            } finally {
              setBusy(false);
            }
          }}
        >
          {!current && (
            <option value="" disabled>
              Choose a section
            </option>
          )}
          {sections.map((section) => (
            <option key={section.href} value={section.href}>
              {section.label}
            </option>
          ))}
        </select>
      </label>
      {canShare &&
        (beforeNavigate ? (
          <DesignLink
            flush={beforeNavigate}
            href={sharingHref}
            className="project-client-links"
          >
            <Link2 size={14} /> Client links
          </DesignLink>
        ) : (
          <Link href={sharingHref} className="project-client-links">
            <Link2 size={14} /> Client links
          </Link>
        ))}
      {busy && (
        <span className="sr-only" role="status">
          Saving before opening section…
        </span>
      )}
    </nav>
    <nav className="project-phase-strip" aria-label="Workflow phases">
      {getWorkflow(project).phases.map((phase, index) => {
        const href = `/projects/${project.id}/phases/${phase.key}`;
        const props = { href, "aria-current": pathname === href || pathname.startsWith(`${href}/`) ? "page" as const : undefined, "data-state": phaseState(project, phase.key), children: <><span aria-hidden="true">{phaseState(project, phase.key) === "complete" ? <Check size={12} /> : index + 1}</span>{phase.name}</> };
        return beforeNavigate ? <DesignLink key={phase.key} {...props} flush={beforeNavigate} /> : <Link key={phase.key} {...props} />;
      })}
    </nav>
    </div>
  );
}
