"use client";
import { useEffect, useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { SettingsTabs } from "@/components/views/SettingsTabs";
import { commsRequest } from "@/lib/comms/client";
import "./comms.css";
import type { CallSettingsInput, CallSettingsView } from "@/lib/comms/calls";

const MODELS = [
  ["whisper-1", "Whisper (about R0.11 a minute)"],
  ["gpt-4o-mini-transcribe", "GPT-4o mini transcribe (cheaper)"],
  ["gpt-4o-transcribe", "GPT-4o transcribe (most accurate)"],
] as const;

/** The Admin's settings for video calls: which service carries them, relays, recording and transcription. */
export function CallSettingsPage() {
  const { toast, persistence } = useStudio();
  const [settings, setSettings] = useState<CallSettingsView | null>(null);
  const [error, setError] = useState("");
  const [lk, setLk] = useState({ url: "", apiKey: "", secret: "" });
  const [turn, setTurn] = useState({ urls: "", username: "", credential: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (persistence !== "server") return;
    commsRequest<CallSettingsView>("/api/admin/calls").then(
      (s) => {
        setSettings(s);
        setLk({ url: s.livekit?.url ?? "", apiKey: s.livekit?.apiKey ?? "", secret: "" });
        setTurn({ urls: s.turn?.urls.join("\n") ?? "", username: s.turn?.username ?? "", credential: "" });
      },
      (e: Error) => setError(e.message),
    );
  }, [persistence]);

  const save = async (change: CallSettingsInput, done = "Saved") => {
    setBusy(true);
    try {
      const s = await commsRequest<CallSettingsView>("/api/admin/calls", { method: "PUT", body: JSON.stringify(change) });
      setSettings(s);
      toast(done);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page-narrow">
      <SettingsTabs />
      <header className="rise" style={{ marginBottom: "2rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Admin settings</p>
        <h1 className="display-l">Calls</h1>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          How project meetings are carried, recorded and transcribed. Calls work out of the box for up to six people. Secrets are stored encrypted and never shown again.
        </p>
      </header>
      {persistence !== "server" && <p className="card" style={{ padding: "1.25rem 1.4rem" }}>These settings are kept on the server. Sign in as the Admin to change them.</p>}
      {error && <div className="card" style={{ padding: "1.25rem 1.4rem", color: "var(--bad)" }}>{error}</div>}
      {settings && (
        <div className="stack" style={{ gap: "1.25rem" }}>
          <section className="card stack" style={{ padding: "1.25rem 1.4rem", gap: "0.8rem" }}>
            <h2 className="display-s">Call service</h2>
            <div className="segmented" role="group" aria-label="Call service">
              <button type="button" aria-pressed={settings.provider === "builtin"} disabled={busy} onClick={() => void save({ provider: "builtin" }, "Calls use the built-in service")}>
                Built in (up to 6 people)
              </button>
              <button type="button" aria-pressed={settings.provider === "livekit"} disabled={busy || !settings.livekit} onClick={() => void save({ provider: "livekit" }, "Calls use LiveKit")}>
                LiveKit (large calls)
              </button>
            </div>
            <p className="small muted">
              The built-in service connects each browser straight to the others, so it needs no account and costs nothing. For calls with more than six people, or a lot of screen sharing, add a LiveKit server (LiveKit Cloud or your own) and switch to it. Meetings already started keep their service.
            </p>
            <form
              className="stack"
              style={{ gap: "0.6rem" }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (await save({ livekit: { url: lk.url, apiKey: lk.apiKey, ...(lk.secret ? { secret: lk.secret } : {}) } }, "LiveKit saved")) setLk((x) => ({ ...x, secret: "" }));
              }}
            >
              <label className="field">
                <span className="field-label">LiveKit address</span>
                <input className="input" value={lk.url} placeholder="wss://your-project.livekit.cloud" onChange={(e) => setLk({ ...lk, url: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">API key</span>
                <input className="input" value={lk.apiKey} autoComplete="off" onChange={(e) => setLk({ ...lk, apiKey: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">API secret {settings.livekit ? `(saved, ends ${settings.livekit.hint}; leave empty to keep it)` : ""}</span>
                <input className="input" type="password" value={lk.secret} autoComplete="new-password" onChange={(e) => setLk({ ...lk, secret: e.target.value })} />
              </label>
              <div className="row wrap" style={{ gap: "0.5rem" }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !lk.url || !lk.apiKey}>
                  Save LiveKit
                </button>
                {settings.livekit && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => confirm("Remove the LiveKit details? Calls go back to the built-in service.") && void save({ provider: "builtin", livekit: null }, "LiveKit removed")}>
                    Remove
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className="card stack" style={{ padding: "1.25rem 1.4rem", gap: "0.8rem" }}>
            <h2 className="display-s">Relay for strict networks</h2>
            <p className="small muted">
              Some office and mobile networks block direct calls. A relay (TURN server, for example from Cloudflare, Twilio or Metered) carries the call for them. Without one, most calls still connect.
            </p>
            <form
              className="stack"
              style={{ gap: "0.6rem" }}
              onSubmit={async (e) => {
                e.preventDefault();
                const urls = turn.urls.split(/\s+/).filter(Boolean);
                if (await save({ turn: { urls, username: turn.username, ...(turn.credential ? { credential: turn.credential } : {}) } }, "Relay saved")) setTurn((x) => ({ ...x, credential: "" }));
              }}
            >
              <label className="field">
                <span className="field-label">Relay addresses, one a line</span>
                <textarea className="input" rows={2} value={turn.urls} placeholder="turns:turn.example.com:443?transport=tcp" onChange={(e) => setTurn({ ...turn, urls: e.target.value })} style={{ height: "auto", paddingTop: "0.6rem" }} />
              </label>
              <label className="field">
                <span className="field-label">Username</span>
                <input className="input" value={turn.username} autoComplete="off" onChange={(e) => setTurn({ ...turn, username: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">Password {settings.turn ? "(saved; leave empty to keep it)" : ""}</span>
                <input className="input" type="password" value={turn.credential} autoComplete="new-password" onChange={(e) => setTurn({ ...turn, credential: e.target.value })} />
              </label>
              <div className="row wrap" style={{ gap: "0.5rem" }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !turn.urls.trim()}>
                  Save relay
                </button>
                {settings.turn && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void save({ turn: null }, "Relay removed")}>
                    Remove
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className="card stack" style={{ padding: "1.25rem 1.4rem", gap: "0.8rem" }}>
            <h2 className="display-s">Recording and transcripts</h2>
            <label className="mt-check">
              <input type="checkbox" checked={settings.recording.enabled} disabled={busy} onChange={(e) => void save({ recording: { enabled: e.target.checked } }, e.target.checked ? "Recording switched on" : "Recording switched off")} />
              Studios may record calls. Everyone in the call is asked to agree first, and people who don&apos;t are left out of the recording and transcript.
            </label>
            <label className="mt-check">
              <input
                type="checkbox"
                checked={settings.transcription.enabled}
                disabled={busy}
                onChange={(e) => void save({ transcription: { enabled: e.target.checked, model: settings.transcription.model as (typeof MODELS)[number][0] } })}
              />
              Transcribe recordings with OpenAI after the call, then take notes with the assistant
            </label>
            <label className="field">
              <span className="field-label">Transcription model</span>
              <select
                className="input"
                value={settings.transcription.model}
                disabled={busy}
                onChange={(e) => void save({ transcription: { enabled: settings.transcription.enabled, model: e.target.value as (typeof MODELS)[number][0] } })}
              >
                {MODELS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <p className="small muted">
              {settings.transcription.keySaved
                ? "Uses the OpenAI key saved under AI models. Its cost is logged with the project's AI spend."
                : "Add an OpenAI key under AI models to transcribe recordings. Until then, live captions from the browser (Chrome, Edge, Safari) and uploaded transcripts from Teams, Zoom or Meet still give meetings a transcript."}
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
