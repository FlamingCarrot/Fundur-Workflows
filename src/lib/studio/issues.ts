import type { IssueReport } from "./types";

/** The browser's calls for the signed-in person's own issue reports. */

export interface IssueInput {
  moduleKey: string;
  note: string;
  path: string;
  projectId?: string;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const issuesApi = {
  list: () => call<{ issues: IssueReport[] }>("/api/issues").then((b) => b.issues),
  create: (input: IssueInput) =>
    call<{ issue: IssueReport }>("/api/issues", { method: "POST", body: JSON.stringify(input) }).then((b) => b.issue),
  edit: (id: string, note: string) =>
    call<{ issue: IssueReport }>(`/api/issues/${id}`, { method: "PATCH", body: JSON.stringify({ note }) }).then((b) => b.issue),
  close: (id: string) =>
    call<{ issue: IssueReport }>(`/api/issues/${id}`, { method: "PATCH", body: JSON.stringify({ close: true }) }).then((b) => b.issue),
};

/** Reports made before they were kept on the server, still waiting in this browser. */
export const LEGACY_ISSUES_KEY = "fundur.studio.issues.v1";

/** Reports from older saves have no status; they were all still open. */
export function normaliseIssue(issue: IssueReport): IssueReport {
  return { ...issue, status: issue.status ?? "open" };
}
