import { getForm, getWorkflow } from "@/lib/workflow";
import { projectTasks } from "./tasks";
import type { Project } from "./types";

/**
 * One search across projects, clients, documents and tasks (P2-08).
 *
 * It runs over the projects already loaded in the browser, which is every
 * project of the workspace, so results appear as she types with no round trip.
 * If a workspace ever grows past what a browser should hold, this is the piece
 * that moves to a database query.
 */

export type ResultKind = "project" | "client" | "document" | "task" | "brief";

export interface SearchResult {
  kind: ResultKind;
  id: string;
  title: string;
  /** Where it sits, for the line under the title. */
  context: string;
  href: string;
  projectId: string;
  /** Higher is a better match; a title match beats a mention inside text. */
  score: number;
}

export const KIND_LABEL: Record<ResultKind, string> = {
  project: "Projects",
  client: "Clients",
  task: "Tasks",
  document: "Documents",
  brief: "In the brief",
};

const KIND_ORDER: ResultKind[] = ["project", "client", "task", "document", "brief"];

function score(haystack: string, needle: string): number {
  const text = haystack.toLowerCase();
  const i = text.indexOf(needle);
  if (i < 0) return 0;
  if (text === needle) return 100;
  if (i === 0) return 80;
  // A match at a word start reads as more relevant than one inside a word.
  return /\s|[-_/]/.test(text[i - 1]) ? 60 : 30;
}

/** A short piece of the text around the match, for the line under the title. */
function excerpt(text: string, needle: string, length = 90): string {
  const i = text.toLowerCase().indexOf(needle);
  if (i < 0) return text.slice(0, length);
  const from = Math.max(0, i - 24);
  const piece = text.slice(from, from + length).trim();
  return `${from > 0 ? "…" : ""}${piece}${from + length < text.length ? "…" : ""}`;
}

export function search(projects: Project[], query: string, limitPerKind = 5): { kind: ResultKind; results: SearchResult[] }[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const found: SearchResult[] = [];

  for (const project of projects) {
    const base = { projectId: project.id };
    const phaseName = (key: string) => getWorkflow(project).phases.find((p) => p.key === key)?.name ?? key;

    const projectScore = score(project.name, needle);
    if (projectScore) {
      found.push({
        ...base,
        kind: "project",
        id: project.id,
        title: project.name,
        context: `${project.client} · ${phaseName(project.currentPhase)}`,
        href: `/projects/${project.id}`,
        score: projectScore,
      });
    }

    const clientScore = score(project.client, needle);
    if (clientScore) {
      found.push({
        ...base,
        kind: "client",
        id: `${project.id}-client`,
        title: project.client,
        context: project.name,
        href: `/projects/${project.id}`,
        score: clientScore,
      });
    }

    for (const task of projectTasks(project)) {
      const s = score(task.title, needle);
      if (!s) continue;
      found.push({
        ...base,
        kind: "task",
        id: `${project.id}-${task.id}`,
        title: task.title,
        context: `${project.name} · ${phaseName(task.phaseKey)}${task.done ? " · done" : ""}`,
        href: `/projects/${project.id}/phases/${task.phaseKey}`,
        score: s,
      });
    }

    for (const doc of project.documents) {
      const s = score(doc.name, needle);
      if (!s) continue;
      found.push({
        ...base,
        kind: "document",
        id: `${project.id}-${doc.id}`,
        title: doc.name,
        context: `${project.name} · ${phaseName(doc.phaseKey)}`,
        href: `/projects/${project.id}/documents`,
        score: s,
      });
    }

    for (const field of getForm(project, "brief")?.fields ?? []) {
      const value = project.brief[field.key];
      if (!value) continue;
      const s = score(value, needle);
      if (!s) continue;
      found.push({
        ...base,
        kind: "brief",
        id: `${project.id}-${field.key}`,
        title: `${field.label} · ${project.name}`,
        context: excerpt(value, needle),
        href: `/projects/${project.id}/brief`,
        // The brief is the body of a project, so a mention there ranks below a name.
        score: s - 10,
      });
    }
  }

  return KIND_ORDER.map((kind) => ({
    kind,
    results: found
      .filter((r) => r.kind === kind)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, limitPerKind),
  })).filter((group) => group.results.length > 0);
}

/** Every result in the order shown, for keyboard movement through the list. */
export function flatten(groups: { results: SearchResult[] }[]): SearchResult[] {
  return groups.flatMap((g) => g.results);
}
