"use client";

import React from "react";
import { Square } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { entryMinutes } from "@/lib/business/model";
import { send, useTime } from "./useBusiness";
import "./business.css";

/** Her running timer, wherever she is in the app, with a stop button. */
export function TimerChip() {
  const { data, mutate } = useTime();
  const { toast } = useStudio();
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const again = () => mutate();
    window.addEventListener("fundur:timer", again);
    return () => window.removeEventListener("fundur:timer", again);
  }, [mutate]);
  const running = data?.running;
  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [running]);
  if (!running) return null;
  const m = entryMinutes(running);
  const stop = async () => {
    try {
      await send("/api/business/time", "POST", { action: "stop" });
      await mutate();
      window.dispatchEvent(new Event("fundur:timer"));
      toast("Time logged");
    } catch (err) {
      toast((err as Error).message);
    }
  };
  return (
    <div className="timer-chip no-print" role="status">
      <span className="truncate">{running.projectName ?? "Studio time"}</span>
      <span className="tabular">{Math.floor(m / 60)}:{String(m % 60).padStart(2, "0")}</span>
      <button type="button" aria-label="Stop the timer" title="Stop the timer" onClick={stop}>
        <Square size={12} />
      </button>
    </div>
  );
}
