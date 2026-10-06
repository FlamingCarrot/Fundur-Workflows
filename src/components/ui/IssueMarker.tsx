"use client";

import { useStudio } from "@/components/providers/StudioProvider";
import { isActiveIssue } from "@/lib/studio/types";

/**
 * The red marker on a module where the person reported issues, with how many
 * are still open. It opens their reports for that spot. Nothing shows when
 * there are none.
 */
export function IssueMarker({
  moduleKey,
  projectId,
  className = "",
}: {
  moduleKey: string;
  projectId?: string;
  className?: string;
}) {
  const { issues, showMyIssues } = useStudio();
  const count = issues.filter(
    (i) => isActiveIssue(i) && i.moduleKey === moduleKey && (i.projectId ?? null) === (projectId ?? null)
  ).length;
  if (!count) return null;
  return (
    <button
      type="button"
      className={`issue-marker ${className}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        showMyIssues({ moduleKey, projectId });
      }}
      aria-label={`${count} open ${count === 1 ? "report" : "reports"} here`}
      title={`${count} open ${count === 1 ? "report" : "reports"} here`}
    >
      {count}
    </button>
  );
}
