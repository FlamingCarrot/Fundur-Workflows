"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useStudio } from "@/components/providers/StudioProvider";
import { demoComms } from "@/lib/comms/client";
import type { Meeting } from "@/lib/comms/types";
import { canUseTool } from "@/lib/team/access";
import { ScheduleMeeting } from "./Meetings";
import { useProjectComms } from "./useComms";
import "./comms.css";

const TOOL = "conversations";
export const meetingPath = (m: Pick<Meeting, "projectId" | "id">) => `/projects/${m.projectId}/conversations/meetings/${m.id}`;

/**
 * Project meetings between two days, for the calendar: from the server once
 * signed in, from this browser's copy in the demo. `version` reloads them.
 */
export function useProjectMeetings(from: string, to: string, version = 0): Meeting[] {
  const { persistence, projects, viewer } = useStudio();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const slugs = projects.filter((p) => canUseTool(p.myAccess, TOOL)).map((p) => p.id).join(",");
  useEffect(() => {
    let live = true;
    const fromIso = new Date(`${from}T00:00`).toISOString();
    const toIso = new Date(`${to}T00:00`).toISOString();
    const load =
      persistence === "server"
        ? fetch(`/api/meetings?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`)
            .then((r) => (r.ok ? r.json() : { meetings: [] }))
            .then((r: { meetings: Meeting[] }) => r.meetings)
        : Promise.all(slugs.split(",").filter(Boolean).map((id) => demoComms(id, { key: viewer.userId ?? "demo", name: viewer.name, kind: "team" }).meetings({ from: fromIso, to: toIso }))).then((all) => all.flat());
    load.then((m) => live && setMeetings(m.filter((x) => x.status !== "cancelled")), () => undefined);
    return () => {
      live = false;
    };
  }, [persistence, from, to, slugs, version, viewer.userId, viewer.name]);
  return meetings;
}

function ScheduleFor({ projectId, day, onDone }: { projectId: string; day: string; onDone: () => void }) {
  const backend = useProjectComms(projectId);
  const router = useRouter();
  return (
    <ScheduleMeeting
      day={day}
      onCancel={onDone}
      onSchedule={async (input, startNow) => {
        const m = await backend.createMeeting(input);
        onDone();
        if (startNow) router.push(`${meetingPath({ projectId, id: m.id })}?join=1`);
      }}
    />
  );
}

/** "Schedule a meeting" on the calendar: pick the project, then the time. */
export function ScheduleMeetingButton({ day, onScheduled }: { day: string; onScheduled: () => void }) {
  const { projects } = useStudio();
  const choices = projects.filter((p) => p.status === "active" && canUseTool(p.myAccess, TOOL) && p.myAccess?.level !== "view");
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "Tab") {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);
  if (!choices.length) return null;
  const chosen = choices.find((p) => p.id === projectId) ?? choices[0];
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        <CalendarPlus size={15} /> Schedule a meeting
      </button>
      {open && createPortal(
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div ref={dialog} className="sheet cv-sheet" role="dialog" aria-modal="true" aria-labelledby="schedule-title">
            <div className="row-between">
              <h2 id="schedule-title" className="display-s">
                Schedule a meeting
              </h2>
              <button type="button" className="icon-btn" aria-label="Close" autoFocus onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <label className="field">
              <span className="field-label">Project</span>
              <select className="input" value={chosen.id} onChange={(e) => setProjectId(e.target.value)}>
                {choices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <ScheduleFor
              key={chosen.id}
              projectId={chosen.id}
              day={day}
              onDone={() => {
                setOpen(false);
                onScheduled();
              }}
            />
          </div>
        </>, document.body
      )}
    </>
  );
}
