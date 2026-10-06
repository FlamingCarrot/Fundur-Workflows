import { getWorkflow } from "@/lib/workflow";
import { dayToDate, toDay } from "./tasks";
import type { Project } from "./types";

/**
 * When each phase of a project runs (P2-06).
 *
 * The workflow says when its steps are due, counted in days from the start of
 * the project, so a phase runs from its first dated step to its last. Moving a
 * phase on the timeline shifts it off that plan, and every step inside it moves
 * with it, which is what makes the timeline worth dragging.
 */

const DAY = 86_400_000;
/** A phase whose steps carry no dates still takes time; this is what it is drawn as. */
export const DEFAULT_PHASE_DAYS = 14;

export interface PhaseSpan {
  key: string;
  name: string;
  /** The day it starts, as YYYY-MM-DD. */
  start: string;
  /** The last day it covers. */
  end: string;
  /** How many days it has been shifted off the workflow's own plan. */
  shiftDays: number;
  days: number;
}

export function addDays(day: string, days: number): string {
  return toDay(new Date(dayToDate(day).getTime() + days * DAY));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((dayToDate(to).getTime() - dayToDate(from).getTime()) / DAY);
}

/** The plan the workflow itself describes, before anything was moved. */
export function plannedSpans(project: Project): PhaseSpan[] {
  const projectStart = toDay(new Date(project.startDate));
  const spans: PhaseSpan[] = [];
  let previousEnd = projectStart;
  for (const phase of getWorkflow(project).phases) {
    const dated = phase.checklist.map((i) => i.relativeDaysDue).filter((d): d is number => d != null);
    const start = dated.length ? addDays(projectStart, Math.min(...dated)) : previousEnd;
    const end = dated.length ? addDays(projectStart, Math.max(...dated)) : addDays(start, DEFAULT_PHASE_DAYS);
    // A phase never starts before the one before it ends; the plan reads left to right.
    const from = start < previousEnd ? previousEnd : start;
    const to = end < from ? from : end;
    spans.push({ key: phase.key, name: phase.name, start: from, end: to, shiftDays: 0, days: daysBetween(from, to) + 1 });
    previousEnd = to;
  }
  return spans;
}

/** Where each phase actually sits, with anything she moved applied. */
export function phaseSpans(project: Project): PhaseSpan[] {
  return plannedSpans(project).map((span) => {
    const moved = project.phaseDates?.[span.key];
    if (!moved) return span;
    const shiftDays = daysBetween(span.start, moved);
    return { ...span, start: moved, end: addDays(span.end, shiftDays), shiftDays };
  });
}

/** How far the phase a step belongs to has been moved, in days. */
export function shiftForPhase(project: Project, phaseKey: string): number {
  return phaseSpans(project).find((s) => s.key === phaseKey)?.shiftDays ?? 0;
}

/** The first and last day covered by a project's phases. */
export function projectRange(project: Project): { start: string; end: string } {
  const spans = phaseSpans(project);
  return { start: spans[0]?.start ?? toDay(new Date(project.startDate)), end: spans[spans.length - 1]?.end ?? toDay(new Date(project.startDate)) };
}

/** The range that covers every project shown, so their bars can be compared. */
export function timelineRange(projects: Project[]): { start: string; end: string; days: number } {
  const ranges = projects.map(projectRange);
  const today = toDay(new Date());
  const start = ranges.reduce((min, r) => (r.start < min ? r.start : min), today);
  const end = ranges.reduce((max, r) => (r.end > max ? r.end : max), addDays(today, 30));
  return { start, end, days: daysBetween(start, end) + 1 };
}
