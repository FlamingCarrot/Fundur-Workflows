"use client";

import React, { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";

async function call<T>(method: string): Promise<T> {
  const res = await fetch("/api/calendar/feed", { method });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "That didn't work. Try again.");
  return body as T;
}

/**
 * A private feed address the person adds to Google Calendar, Apple Calendar or
 * Outlook, so their due steps, to-dos and booked meetings show up there too.
 */
export function CalendarSync() {
  const { persistence, toast } = useStudio();
  const server = persistence === "server";
  const [active, setActive] = useState<boolean | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!server) return;
    call<{ active: boolean }>("GET").then((r) => setActive(r.active), () => setActive(false));
  }, [server]);

  const turnOn = async () => {
    if (active && !window.confirm("Make a new address? The old one stops working, so calendars using it need the new one.")) return;
    setBusy(true);
    try {
      const { token } = await call<{ token: string }>("POST");
      setAddress(`${window.location.origin}/api/calendar/feed/${token}.ics`);
      setActive(true);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (!window.confirm("Turn off the calendar feed? Calendars following it stop updating.")) return;
    setBusy(true);
    try {
      await call("DELETE");
      setActive(false);
      setAddress("");
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(address).then(() => toast("Address copied"), () => toast("Select the address and copy it"));
  };

  return (
    <section className="card settings-section rise" style={{ ["--i" as string]: 2 }}>
      <div>
        <h2 className="display-s">Sync with your calendar</h2>
        <p className="small muted" style={{ marginTop: "0.35rem", maxWidth: 620 }}>
          Follow your due steps, to-dos and booked meetings in Google Calendar, Apple Calendar or Outlook. Add the address as a
          calendar &ldquo;from URL&rdquo;; your calendar checks it for changes every few hours.
        </p>
      </div>
      {!server ? (
        <p className="small muted">Calendar sync works once you are signed in to a studio with its own database.</p>
      ) : active === null ? (
        <p className="small muted">Checking…</p>
      ) : (
        <>
          {address && (
            <div className="feed-address">
              <input className="input" readOnly value={address} onFocus={(e) => e.currentTarget.select()} aria-label="Calendar feed address" />
              <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
                <Copy size={14} /> Copy
              </button>
              <a className="btn btn-ghost btn-sm" href={address.replace(/^https?:/, "webcal:")}>
                Open in calendar app
              </a>
              <p className="small muted" style={{ gridColumn: "1 / -1" }}>
                Keep this address private: anyone with it can see these dates. It is only shown now; make a new one if you lose it.
              </p>
            </div>
          )}
          {active && !address && <p className="small">The feed is on.</p>}
          <div className="row" style={{ gap: "0.5rem" }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={turnOn}>
              {active ? "Make a new address" : "Turn on calendar sync"}
            </button>
            {active && (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={turnOff}>
                Turn off
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
