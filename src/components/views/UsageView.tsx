"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MousePointerClick, AlertTriangle, Monitor, Smartphone, Tablet } from "lucide-react";
import { relativeTime } from "@/lib/studio/format";
import { routeName, type Device } from "@/lib/analytics/events";
import type { Heatmap, LiveEvent, LiveSession, Overview } from "@/lib/analytics/store";
import { SettingsTabs } from "./SettingsTabs";

/**
 * The Admin's usage pages: who is in the app right now and what they are
 * doing, how the app was used over a period, and where people click.
 */

type Tab = "live" | "overview" | "heatmap";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

/** A view setting that is kept in this browser and restored next time. */
export function useRemembered<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      // Restored after the first render so the server and browser render the same page.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      // Private windows may refuse storage; the default stands.
    }
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // As above.
      }
    },
    [key]
  );
  return [value, set];
}

const PERIODS = [7, 30, 90] as const;

export function UsageView() {
  const [tab, setTab] = useRemembered<Tab>("fundur.usage.tab", "live");
  const [days, setDays] = useRemembered<number>("fundur.usage.days", 30);
  const [includeAdmin, setIncludeAdmin] = useRemembered<boolean>("fundur.usage.includeAdmin", false);

  return (
    <main className="page">
      <SettingsTabs />
      <header className="rise" style={{ marginBottom: "1.75rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Admin</p>
        <h1 className="display-l">Usage</h1>
        <p className="muted" style={{ marginTop: "0.75rem", maxWidth: 640 }}>
          Every page, click, action and error in the app, kept in your own database. What people type is never
          recorded.
        </p>
      </header>

      <div className="row wrap rise" style={{ gap: "0.75rem", marginBottom: "1.75rem", alignItems: "center" }}>
        <div className="segmented" role="group" aria-label="View">
          {(
            [
              ["live", "Live"],
              ["overview", "Overview"],
              ["heatmap", "Heat map"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
        {tab !== "live" && (
          <div className="segmented" role="group" aria-label="Period">
            {PERIODS.map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>
                {d} days
              </button>
            ))}
          </div>
        )}
        <label className="row small muted" style={{ gap: "0.5rem", marginLeft: "auto", cursor: "pointer" }}>
          <button
            type="button"
            role="switch"
            aria-checked={includeAdmin}
            className="switch"
            onClick={() => setIncludeAdmin(!includeAdmin)}
          />
          Include my own activity
        </label>
      </div>

      {tab === "live" && <Live key={String(includeAdmin)} includeAdmin={includeAdmin} />}
      {tab === "overview" && <OverviewPanel days={days} includeAdmin={includeAdmin} />}
      {tab === "heatmap" && <HeatmapPanel days={days} includeAdmin={includeAdmin} />}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

const LIVE_POLL_MS = 3_000;
const STREAM_MAX = 200;

const DEVICE_ICON: Record<Device, React.ReactNode> = {
  desktop: <Monitor size={14} />,
  tablet: <Tablet size={14} />,
  phone: <Smartphone size={14} />,
};

const who = (u: { name: string | null; email: string | null } | null) => u?.name || u?.email || "Someone";

function describe(e: LiveEvent): string {
  const page = routeName(e.route);
  switch (e.type) {
    case "page_view":
      return `opened ${page}`;
    case "page_leave":
      return `left ${page}${e.durationMs != null ? ` after ${seconds(e.durationMs / 1000)}` : ""}`;
    case "click":
      return `clicked “${e.target ?? "something"}” on ${page}`;
    case "action":
      return `${actionName(e.target ?? "")} on ${page}`;
    case "error":
      return `hit an error on ${page}: ${e.target ?? ""}`;
    default:
      return `${e.type} on ${page}`;
  }
}

function seconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

const ACTION_NAMES: Record<string, string> = {
  setCheck: "ticked a step",
  setWaitingOn: "changed who it's waiting on",
  setStatus: "changed a project's status",
  updateBrief: "edited the brief",
  addDocuments: "uploaded documents",
  toggleClientVisible: "changed what the client sees",
  completePhase: "completed a phase",
  addTask: "added a task",
  changeTask: "changed a task",
  deleteTask: "deleted a task",
  setPhaseStart: "moved a phase",
  setStepTask: "dated a step",
  createProject: "created a project",
  reportIssue: "reported an issue",
  removeIssue: "closed a report",
};

export function actionName(name: string): string {
  return ACTION_NAMES[name] ?? name;
}

function Live({ includeAdmin }: { includeAdmin: boolean }) {
  const [online, setOnline] = useState<LiveSession[] | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let after = 0;
    const poll = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      getJson<{ online: LiveSession[]; events: LiveEvent[]; lastId: number }>(
        `/api/admin/analytics/live?after=${after}${includeAdmin ? "&admin=1" : ""}`
      )
        .then((body) => {
          if (cancelled) return;
          after = Math.max(after, body.lastId);
          setOnline(body.online);
          if (body.events.length) setEvents((list) => [...body.events, ...list].slice(0, STREAM_MAX));
          setTick((t) => t + 1);
          setError(null);
        })
        .catch((err: Error) => !cancelled && setError(err.message))
        .finally(() => {
          if (!cancelled) timer = setTimeout(poll, LIVE_POLL_MS);
        });
    };
    poll();
    document.addEventListener("visibilitychange", poll);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [includeAdmin]);

  return (
    <div className="usage-live">
      <section>
        <div className="section-title">
          <h2>
            <span className={`live-dot ${error ? "offline" : ""}`} style={{ marginRight: "0.6rem" }} />
            In the app now
            <span className="count">{online?.length ?? 0}</span>
          </h2>
        </div>
        {error && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{error}</p>}
        {online && online.length === 0 && <p className="muted small">Nobody right now. People show here within seconds of opening the app.</p>}
        <div className="stack" style={{ gap: "0.6rem" }}>
          {online?.map((s) => (
            <article key={s.sessionId} className="card" style={{ padding: "0.9rem 1.1rem" }}>
              <div className="row-between" style={{ gap: "0.5rem" }}>
                <span className="small strong truncate">{who(s.user)}</span>
                <span className="tiny muted row" style={{ gap: "0.3rem" }}>
                  {s.device && DEVICE_ICON[s.device]} {s.events} events
                </span>
              </div>
              <p className="small" style={{ marginTop: "0.25rem" }}>
                On <strong>{routeName(s.route)}</strong> <code className="tiny muted">{s.path}</code>
              </p>
              <p className="tiny muted" style={{ marginTop: "0.2rem" }}>
                {s.workspace ? `${s.workspace} · ` : ""}here since {relativeTime(s.startedAt)}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="section-title">
          <h2>Live events</h2>
        </div>
        {events.length === 0 ? (
          <p className="muted small">New events stream in here as they happen.</p>
        ) : (
          <ol className="usage-stream">
            {events.map((e) => (
              <li key={e.id} className={e.type === "error" ? "is-error" : undefined}>
                <span className="usage-stream-icon">
                  {e.type === "error" ? <AlertTriangle size={14} /> : e.type === "click" ? <MousePointerClick size={14} /> : <span className="usage-stream-dot" />}
                </span>
                <span className="small grow">
                  <strong>{who(e.user)}</strong> {describe(e)}
                </span>
                <time className="tiny muted tabular" dateTime={e.at}>{relativeTime(e.at)}</time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewPanel({ days, includeAdmin }: { days: number; includeAdmin: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getJson<Overview>(`/api/admin/analytics/overview?days=${days}${includeAdmin ? "&admin=1" : ""}`).then(
      (d) => !cancelled && (setData(d), setError(null)),
      (err: Error) => !cancelled && setError(err.message)
    );
    return () => {
      cancelled = true;
    };
  }, [days, includeAdmin]);

  if (error) return <p className="small" role="alert" style={{ color: "var(--bad)" }}>{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const t = data.totals;
  const p = data.previous;
  const maxFunnel = Math.max(1, ...data.funnel.map((f) => f.users));

  return (
    <div className="stack" style={{ gap: "2.25rem" }}>
      <div className="usage-tiles">
        <Tile label="Active people" value={t.activeUsers} before={p.activeUsers} />
        <Tile label="Visits" value={t.sessions} before={p.sessions} />
        <Tile label="Page views" value={t.pageViews} before={p.pageViews} />
        <Tile label="Actions" value={t.actions} before={p.actions} />
        <Tile label="Avg visit" value={t.avgSessionMinutes} before={p.avgSessionMinutes} unit=" min" />
        <Tile label="Errors" value={t.errors} before={p.errors} lowerIsBetter />
      </div>
      <p className="small muted" style={{ marginTop: "-1.25rem" }}>
        Compared with the {data.days} days before. {data.signups} new sign-up{data.signups === 1 ? "" : "s"}, {data.returningUsers}{" "}
        returning {data.returningUsers === 1 ? "person" : "people"}.
      </p>

      <section>
        <div className="section-title"><h2>Page views by day</h2></div>
        <DailyBars daily={data.daily} days={data.days} />
      </section>

      <section>
        <div className="section-title"><h2>How far people get</h2></div>
        <div className="stack" style={{ gap: "0.5rem" }}>
          {data.funnel.map((f, i) => (
            <div key={f.step} className="usage-bar-row">
              <span className="small">{f.step}</span>
              <span className="usage-bar-track">
                <span className="usage-bar-fill" style={{ width: `${(f.users / maxFunnel) * 100}%` }} />
              </span>
              <span className="small tabular strong" style={{ textAlign: "right" }}>
                {f.users}
                {i > 0 && data.funnel[0].users > 0 && (
                  <span className="tiny muted"> {Math.round((f.users / data.funnel[0].users) * 100)}%</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-title"><h2>Pages</h2></div>
        {data.pages.length === 0 ? (
          <p className="muted small">No page views in this period yet.</p>
        ) : (
          <div className="usage-table-wrap">
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Views</th>
                  <th>People</th>
                  <th title="Average time on the page">Time</th>
                  <th title="How far down the page people scrolled, on average">Scroll</th>
                  <th title="Visits that ended on this page">Left here</th>
                  <th title="3+ clicks on the same thing within a second">Angry clicks</th>
                  <th title="Clicks on things that do nothing">Dead clicks</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {data.pages.map((pg) => (
                  <tr key={pg.route}>
                    <td>
                      <span className="strong">{routeName(pg.route)}</span>
                      <br />
                      <code className="tiny muted">{pg.route}</code>
                    </td>
                    <td className="tabular">{pg.views}</td>
                    <td className="tabular">{pg.users}</td>
                    <td className="tabular">{pg.avgSeconds == null ? "–" : seconds(pg.avgSeconds)}</td>
                    <td className="tabular">{pg.avgScroll == null ? "–" : `${Math.round(pg.avgScroll * 100)}%`}</td>
                    <td className="tabular">{pg.views ? `${Math.round((pg.exits / pg.views) * 100)}%` : "–"}</td>
                    <td className={`tabular ${pg.rageClicks ? "usage-flag" : ""}`}>{pg.rageClicks}</td>
                    <td className={`tabular ${pg.deadClicks ? "usage-flag" : ""}`}>{pg.deadClicks}</td>
                    <td className={`tabular ${pg.errors ? "usage-flag" : ""}`}>{pg.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="usage-two">
        <section>
          <div className="section-title"><h2>Features used</h2></div>
          {data.actions.length === 0 ? (
            <p className="muted small">Nothing yet.</p>
          ) : (
            <ul className="usage-list">
              {data.actions.map((a) => (
                <li key={a.name}>
                  <span className="small grow">{actionName(a.name)}</span>
                  <span className="small tabular strong">{a.count}</span>
                  <span className="tiny muted tabular">{a.users} {a.users === 1 ? "person" : "people"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <div className="section-title"><h2>Devices</h2></div>
          <ul className="usage-list">
            {data.devices.map((d) => (
              <li key={d.device}>
                <span className="small grow" style={{ textTransform: "capitalize" }}>{d.device}</span>
                <span className="small tabular strong">{d.sessions}</span>
                <span className="tiny muted">visits</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <div className="section-title"><h2>Where people get stuck</h2></div>
        <div className="usage-two">
          <Frustration
            title="Angry clicks"
            hint="Clicked three or more times within a second."
            rows={data.rageClicks.map((r) => ({ key: r.route + r.target, label: r.target, page: r.route, count: r.bursts, users: r.users }))}
          />
          <Frustration
            title="Clicks that did nothing"
            hint="Clicked something that isn't a button or link."
            rows={data.deadClicks.map((r) => ({ key: r.route + r.target, label: r.target, page: r.route, count: r.count, users: r.users }))}
          />
        </div>
        <div style={{ marginTop: "1.25rem" }}>
          <Frustration
            title="Errors"
            hint="Errors people's browsers hit."
            rows={data.errors.map((r) => ({ key: r.route + r.message, label: r.message, page: r.route, count: r.count, users: r.users }))}
          />
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value, before, unit = "", lowerIsBetter = false }: { label: string; value: number; before: number; unit?: string; lowerIsBetter?: boolean }) {
  const change = before ? Math.round(((value - before) / before) * 100) : null;
  const good = change == null || change === 0 ? null : lowerIsBetter ? change < 0 : change > 0;
  return (
    <div className="card usage-tile">
      <span className="tiny muted">{label}</span>
      <span className="display-s tabular">
        {value}
        {unit}
      </span>
      <span className="tiny" style={{ color: good == null ? "var(--ink-3)" : good ? "var(--good)" : "var(--bad)" }}>
        {change == null ? (before === 0 && value > 0 ? "new" : "–") : `${change > 0 ? "▲" : change < 0 ? "▼" : ""} ${Math.abs(change)}%`}
        <span className="muted"> vs {before}{unit}</span>
      </span>
    </div>
  );
}

function DailyBars({ daily, days }: { daily: Overview["daily"]; days: number }) {
  // Every day in the period, including the quiet ones.
  const series = useMemo(() => {
    const byDay = new Map(daily.map((d) => [d.day, d]));
    const out: Overview["daily"] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      const key = d.toISOString().slice(0, 10);
      out.push(byDay.get(key) ?? { day: key, users: 0, sessions: 0, pageViews: 0 });
    }
    return out;
  }, [daily, days]);
  const max = Math.max(1, ...series.map((d) => d.pageViews));
  return (
    <div className="usage-days" role="img" aria-label="Page views per day">
      {series.map((d) => (
        <span
          key={d.day}
          className="usage-day"
          title={`${d.day}: ${d.pageViews} page views, ${d.users} people, ${d.sessions} visits`}
        >
          <span className="usage-day-bar" style={{ height: `${(d.pageViews / max) * 100}%` }} />
        </span>
      ))}
      <span className="usage-days-axis tiny muted">
        <span>{series[0]?.day.slice(5)}</span>
        <span>max {max}</span>
        <span>{series[series.length - 1]?.day.slice(5)}</span>
      </span>
    </div>
  );
}

function Frustration({
  title,
  hint,
  rows,
}: {
  title: string;
  hint: string;
  rows: { key: string; label: string; page: string; count: number; users: number }[];
}) {
  return (
    <div className="card" style={{ padding: "1rem 1.15rem" }}>
      <p className="small strong">{title}</p>
      <p className="tiny muted" style={{ marginBottom: "0.6rem" }}>{hint}</p>
      {rows.length === 0 ? (
        <p className="tiny muted">None in this period.</p>
      ) : (
        <ul className="usage-list">
          {rows.map((r) => (
            <li key={r.key}>
              <span className="small grow" style={{ minWidth: 0 }}>
                <span className="truncate" style={{ display: "block" }}>{r.label}</span>
                <span className="tiny muted">{routeName(r.page)}</span>
              </span>
              <span className="small tabular strong">×{r.count}</span>
              <span className="tiny muted tabular">{r.users} {r.users === 1 ? "person" : "people"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heat map
// ---------------------------------------------------------------------------

/** The window width each device's map is drawn at. */
const FRAME_WIDTH: Record<Device, number> = { desktop: 1440, tablet: 820, phone: 390 };

function HeatmapPanel({ days, includeAdmin }: { days: number; includeAdmin: boolean }) {
  const [route, setRoute] = useRemembered<string>("fundur.usage.heatRoute", "");
  const [device, setDevice] = useRemembered<Device>("fundur.usage.heatDevice", "desktop");
  const [data, setData] = useState<Heatmap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ days: String(days), device });
    if (route) q.set("route", route);
    if (includeAdmin) q.set("admin", "1");
    getJson<Heatmap>(`/api/admin/analytics/heatmap?${q}`).then(
      (d) => !cancelled && (setData(d), setError(null)),
      (err: Error) => !cancelled && setError(err.message)
    );
    return () => {
      cancelled = true;
    };
  }, [route, device, days, includeAdmin]);

  if (error) return <p className="small" role="alert" style={{ color: "var(--bad)" }}>{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (!data.route) return <p className="muted">No clicks recorded in this period yet. The map fills in as people use the app.</p>;

  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="row wrap" style={{ gap: "0.75rem" }}>
        <select
          className="input"
          style={{ width: "auto", minWidth: 260 }}
          value={data.route}
          onChange={(e) => setRoute(e.target.value)}
          aria-label="Page"
        >
          {!data.routes.some((r) => r.route === data.route) && <option value={data.route}>{routeName(data.route)} (no clicks)</option>}
          {data.routes.map((r) => (
            <option key={r.route} value={r.route}>
              {routeName(r.route)} ({r.clicks} clicks)
            </option>
          ))}
        </select>
        <div className="segmented" role="group" aria-label="Device">
          {(["desktop", "tablet", "phone"] as const).map((d) => (
            <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)} style={{ textTransform: "capitalize" }}>
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="usage-heat-layout">
        <HeatCanvas key={`${data.route}-${device}`} data={data} device={device} />
        <aside className="stack" style={{ gap: "1.25rem" }}>
          <div className="card" style={{ padding: "1rem 1.15rem" }}>
            <p className="small strong" style={{ marginBottom: "0.6rem" }}>Most clicked</p>
            {data.targets.length === 0 ? (
              <p className="tiny muted">No clicks on this device.</p>
            ) : (
              <ul className="usage-list">
                {data.targets.map((t) => (
                  <li key={t.target}>
                    <span className="small grow truncate">{t.target}</span>
                    {t.dead > 0 && <span className="tag tag-hold" style={{ height: 22, fontSize: "0.7rem" }} title="Clicks on something that isn't a button or link">does nothing</span>}
                    <span className="small tabular strong">{t.clicks}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {data.scrollReach.length > 0 && (
            <div className="card" style={{ padding: "1rem 1.15rem" }}>
              <p className="small strong">How far down people scroll</p>
              <p className="tiny muted" style={{ marginBottom: "0.6rem" }}>Share of visits that saw each part of the page.</p>
              <div className="stack" style={{ gap: "0.3rem" }}>
                {data.scrollReach.map((share, i) => (
                  <div key={i} className="usage-bar-row usage-bar-row-sm">
                    <span className="tiny muted tabular">{(i + 1) * 10}%</span>
                    <span className="usage-bar-track">
                      <span className="usage-bar-fill" style={{ width: `${share * 100}%` }} />
                    </span>
                    <span className="tiny tabular">{Math.round(share * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * The page drawn as people saw it, in a frame, with clicks painted over it.
 * A click lands on the element it hit when that element is still on the page;
 * otherwise at its position scaled to this width.
 */
function HeatCanvas({ data, device }: { data: Heatmap; device: Device }) {
  const width = FRAME_WIDTH[device];
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1);
  const maxY = Math.max(0, ...data.points.map((p) => p.y));
  const [height, setHeight] = useState(Math.max(900, maxY + 200));
  const [placed, setPlaced] = useState<{ x: number; y: number }[] | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, box.clientWidth / width)));
    ro.observe(box);
    return () => ro.disconnect();
  }, [width]);

  const place = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const fallback = (p: Heatmap["points"][number]) => ({ x: p.vw ? (p.x * width) / p.vw : p.x, y: p.y });
    if (!doc) {
      setPlaced(data.points.map(fallback));
      return;
    }
    setHeight((h) => Math.max(h, doc.documentElement.scrollHeight));
    const win = doc.defaultView;
    const cache = new Map<string, Element | null>();
    setPlaced(
      data.points.map((p) => {
        if (p.selector) {
          let el = cache.get(p.selector);
          if (el === undefined) {
            try {
              el = doc.querySelector(p.selector);
            } catch {
              el = null;
            }
            cache.set(p.selector, el);
          }
          if (el) {
            const r = el.getBoundingClientRect();
            return {
              x: r.left + (win?.scrollX ?? 0) + (p.ox ?? 0.5) * r.width,
              y: r.top + (win?.scrollY ?? 0) + (p.oy ?? 0.5) * r.height,
            };
          }
        }
        return fallback(p);
      })
    );
  }, [data.points, width]);

  // The page renders its data a moment after it loads, so the dots are placed once it settles.
  const onLoad = useCallback(() => {
    setTimeout(place, 1500);
  }, [place]);

  // If the frame never loads (or is blocked), still show the clicks.
  useEffect(() => {
    const fallback = setTimeout(() => setPlaced((p) => p ?? data.points.map((pt) => ({ x: pt.vw ? (pt.x * width) / pt.vw : pt.x, y: pt.y }))), 6000);
    return () => {
      clearTimeout(fallback);
    };
  }, [data.points, width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !placed) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawHeat(ctx, placed, width, height);
  }, [placed, width, height]);

  return (
    <div ref={boxRef} className="usage-heat-box" style={{ height: height * scale }}>
      <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left", position: "relative" }}>
        {data.samplePath && (
          <iframe
            ref={frameRef}
            src={data.samplePath}
            title="Page preview"
            onLoad={onLoad}
            sandbox="allow-same-origin allow-scripts"
            tabIndex={-1}
            style={{ width, height, border: 0, pointerEvents: "none", display: "block" }}
          />
        )}
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width, height, pointerEvents: "none" }} />
      </div>
      <p className="tiny muted usage-heat-note">
        {data.points.length} clicks{placed ? "" : " (placing…)"} · drawn on {data.samplePath ?? "a blank page"}
      </p>
    </div>
  );
}

/**
 * Each click adds a soft spot; where spots pile up the colour deepens from
 * pale amber to deep red (one hue family, light to dark).
 */
function drawHeat(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  if (!points.length) return;
  const radius = 26;
  const shadow = document.createElement("canvas");
  shadow.width = width;
  shadow.height = height;
  const s = shadow.getContext("2d");
  if (!s) return;
  const weight = Math.min(0.35, Math.max(0.06, 8 / points.length));
  for (const p of points) {
    const g = s.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
    g.addColorStop(0, `rgba(0,0,0,${weight})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    s.fillStyle = g;
    s.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
  }
  const img = s.getImageData(0, 0, width, height);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    if (a === 0) continue;
    // Pale amber (low) to deep red (high).
    px[i] = Math.round(250 - 60 * a);
    px[i + 1] = Math.round(190 - 170 * a);
    px[i + 2] = Math.round(60 - 40 * a);
    px[i + 3] = Math.round(Math.min(1, 0.25 + a * 1.2) * 215);
  }
  ctx.putImageData(img, 0, 0);
}
