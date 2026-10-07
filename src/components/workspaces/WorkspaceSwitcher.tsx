/* eslint-disable @next/next/no-location-assign-relative-destination -- Reload the studio after changing its workspace cookie so no previous workspace state is retained. */
"use client";
import { useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { shareRequest } from "@/components/sharing/client";
export function WorkspaceSwitcher() {
  const { viewer } = useStudio();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!viewer.workspaces?.length) return null;
  return (
    <div style={{ padding: ".6rem .8rem" }}>
      <label className="field">
        <span className="tiny muted">Workspace</span>
        <select
          className="input"
          style={{ fontSize: ".8rem", minWidth: 0, width: "100%" }}
          value={viewer.workspaceId}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            try {
              await shareRequest("/api/workspace", {
                method: "PATCH",
                body: JSON.stringify({ workspaceId: e.target.value }),
              });
              window.location.assign("/");
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
        >
          {viewer.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="tiny" role="alert" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
