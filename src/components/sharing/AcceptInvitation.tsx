/* eslint-disable @next/next/no-location-assign-relative-destination -- Reload the studio after changing its workspace cookie so no previous workspace state is retained. */
"use client";
import { useState } from "react";
import { shareRequest } from "./client";
export function AcceptInvitation({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await shareRequest(`/api/invitations/${token}/accept`, {
              method: "POST",
            });
            window.location.assign("/");
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? "Joining…" : "Join workspace"}
      </button>
      {error && (
        <p
          className="small"
          role="alert"
          style={{ color: "var(--bad)", marginTop: "1rem" }}
        >
          {error}
        </p>
      )}
    </>
  );
}
