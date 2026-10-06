"use client";

import React from "react";
import { Clock, Hourglass, PauseCircle, CircleCheck } from "lucide-react";
import { getWorkflow } from "@/lib/workflow";
import { phaseProgress, phaseState } from "@/lib/studio/selectors";
import type { Project, SwatchKey, WaitingOn, ProjectStatus } from "@/lib/studio/types";

export const SWATCHES: { key: SwatchKey; name: string }[] = [
  { key: "clay", name: "Clay" },
  { key: "sage", name: "Sage" },
  { key: "oak", name: "Oak" },
  { key: "slate", name: "Slate" },
  { key: "blush", name: "Blush" },
  { key: "ochre", name: "Ochre" },
];

export function swatchVar(key: SwatchKey): React.CSSProperties {
  return { ["--swatch" as string]: `var(--swatch-${key})` };
}

export function Swatch({ swatch, size = "sm" }: { swatch: SwatchKey; size?: "sm" | "lg" }) {
  return (
    <span
      className={size === "lg" ? "swatch swatch-lg" : "swatch"}
      style={swatchVar(swatch)}
      aria-hidden
    />
  );
}

export function ProgressRing({
  value,
  size = 44,
  stroke = 4,
  label,
  color,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: React.ReactNode;
  color?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <span className="ring" style={{ width: size, height: size, ["--ring-color" as string]: color }}>
      <svg width={size} height={size} aria-hidden>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
        />
      </svg>
      {label != null && <span className="ring-label">{label}</span>}
    </span>
  );
}

/** Six thin segments: one per phase, filled by progress. */
export function PhaseTrack({ project }: { project: Project }) {
  const phases = getWorkflow(project).phases;
  return (
    <div className="phase-track" style={swatchVar(project.swatch)} aria-label="Phase progress">
      {phases.map((ph) => {
        const state = phaseState(project, ph.key);
        let fill = 0;
        if (state === "complete") fill = 100;
        else if (state === "current") {
          const p = phaseProgress(project, ph.key);
          fill = Math.max(8, p.total ? (p.done / p.total) * 100 : 0);
        }
        return (
          <span key={ph.key} className="phase-seg" title={ph.name}>
            <span style={{ ["--fill" as string]: `${fill}%` }} />
          </span>
        );
      })}
    </div>
  );
}

export function StatusTag({
  project,
  onToggle,
}: {
  project: Pick<Project, "status" | "waitingOn">;
  onToggle?: (next: WaitingOn) => void;
}) {
  if (project.status === "on_hold") return <StatusPill status="on_hold" />;
  if (project.status === "complete") return <StatusPill status="complete" />;
  const isMe = project.waitingOn === "me";
  const content = (
    <>
      {isMe ? <Clock size={12} strokeWidth={2.5} /> : <Hourglass size={12} strokeWidth={2.5} />}
      {isMe ? "Waiting on me" : "Waiting on client"}
    </>
  );
  if (!onToggle) return <span className={`tag ${isMe ? "tag-me" : "tag-client"}`}>{content}</span>;
  return (
    <button
      type="button"
      className={`tag ${isMe ? "tag-me" : "tag-client"}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(isMe ? "client" : "me");
      }}
      title="Switch who this project is waiting on"
    >
      {content}
    </button>
  );
}

function StatusPill({ status }: { status: ProjectStatus }) {
  if (status === "on_hold")
    return (
      <span className="tag tag-hold">
        <PauseCircle size={12} strokeWidth={2.5} /> On hold
      </span>
    );
  return (
    <span className="tag tag-good">
      <CircleCheck size={12} strokeWidth={2.5} /> Complete
    </span>
  );
}

/** Renders children only once client data has loaded, with a quiet placeholder. */
export function WhenReady({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  if (!ready) return <div style={{ minHeight: "60vh" }} aria-busy="true" />;
  return <>{children}</>;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export const CURRENT_USER = {
  name: "Andre Swanepoel",
  firstName: "Andre",
  role: "Workspace owner",
  workspace: "Swanepoel Interiors",
};
