"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { Project } from "@/lib/studio/types";
import {
  ProjectSectionDropdown,
  GlobalProcessStepper,
  ClientLinksButton,
} from "@/components/projects/ProjectNavigation";

/**
 * Full-screen frame for single-task flows: one clear exit,
 * integrated navigation when a project is provided, an optional progress line
 * and a sticky action footer.
 */
export function FocusFrame({
  exitHref,
  exitLabel = "Close",
  beforeExit,
  title,
  right,
  progress,
  footer,
  wide,
  project,
  hideProjectNav = false,
  children,
}: {
  exitHref: string;
  exitLabel?: string;
  beforeExit?: () => Promise<boolean>;
  title?: React.ReactNode;
  right?: React.ReactNode;
  progress?: number;
  footer?: React.ReactNode;
  wide?: boolean;
  project?: Project;
  hideProjectNav?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const handleExitClick = beforeExit
    ? async (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        )
          return;
        e.preventDefault();
        if (await beforeExit()) router.push(exitHref);
      }
    : undefined;

  const exitBtn = (
    <Link
      href={exitHref}
      onClick={handleExitClick}
      className="icon-btn"
      aria-label={exitLabel}
      title={exitLabel}
    >
      <X size={19} />
    </Link>
  );

  const hasProjectNav = !!project && !hideProjectNav;

  return (
    <div className="focus">
      <div style={{ position: "sticky", top: 0, zIndex: 20 }}>
        {hasProjectNav ? (
          <div className="focus-bar focus-bar-integrated">
            <div className="focus-bar-left">
              {exitBtn}
              <ProjectSectionDropdown
                project={project}
                beforeNavigate={beforeExit}
                compact
              />
            </div>
            <div className="focus-bar-center">
              <GlobalProcessStepper
                project={project}
                beforeNavigate={beforeExit}
                compact
              />
            </div>
            <div className="focus-bar-right">
              <ClientLinksButton project={project} beforeNavigate={beforeExit} compact />
              {right}
            </div>
          </div>
        ) : (
          <div className="focus-bar">
            {exitBtn}
            <div
              className="small strong truncate"
              style={{ textAlign: "center" }}
            >
              {title}
            </div>
            <div>{right}</div>
          </div>
        )}

        {progress != null && (
          <div className="focus-progress">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      <main className={`focus-body${wide ? " wide" : ""}`}>{children}</main>
      {footer && (
        <div className="focus-footer">
          <div className="focus-footer-inner">{footer}</div>
        </div>
      )}
    </div>
  );
}
