import type { UsageEventInput } from "./events";

/**
 * The usage tracker in the browser. It records page views (and time and
 * scroll on each page), clicks with where they landed, named actions, and
 * errors, and sends them in small batches. It never records what people type
 * or the values in forms: a click keeps only the element's label.
 */

const SESSION_KEY = "fundur.usage.session";
const IDLE_MS = 30 * 60_000;
const FLUSH_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const ENDPOINT = "/api/analytics/events";

type Pending = UsageEventInput & { at: number };

let queue: Pending[] = [];
let running = false;
let currentPath = "";
/** When the page was last shown, or null while the tab is hidden; time hidden does not count. */
let shownAt: number | null = 0;
let visibleMs = 0;
let maxScroll = 0;

function sessionId(): string {
  const now = Date.now();
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null") as { id: string; at: number } | null;
    const id = saved && now - saved.at < IDLE_MS ? saved.id : randomId();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, at: now }));
    return id;
  } catch {
    return (fallbackId ??= randomId());
  }
}
let fallbackId: string | undefined;

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function push(event: UsageEventInput) {
  if (!running) return;
  queue.push({ ...event, vw: event.vw ?? window.innerWidth, vh: event.vh ?? window.innerHeight, at: Date.now() });
  if (queue.length >= 50) flush();
}

function flush(useBeacon = false) {
  if (!queue.length) return;
  const now = Date.now();
  const events = queue.splice(0, 100).map(({ at, ...e }) => ({ ...e, ageMs: Math.max(0, now - at) }));
  const body = JSON.stringify({ sessionId: sessionId(), events });
  if (useBeacon && navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
  void fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {
    // Analytics never gets in anyone's way; a lost batch is dropped.
  });
}

/** How far down the page has been seen, from 0 to 1. */
function scrollDepth(): number {
  const doc = document.documentElement;
  const seen = window.scrollY + window.innerHeight;
  return doc.scrollHeight > 0 ? Math.min(1, seen / doc.scrollHeight) : 1;
}

function leavePage() {
  if (!currentPath) return;
  const ms = visibleMs + (shownAt == null ? 0 : Date.now() - shownAt);
  push({
    type: "page_leave",
    path: currentPath,
    durationMs: Math.min(ms, 86_400_000),
    data: { scroll: Math.round(Math.max(maxScroll, scrollDepth()) * 100) / 100 },
  });
}

/** Called when the route changes. */
export function trackPage(path: string) {
  if (!running || path === currentPath) return;
  const first = !currentPath;
  leavePage();
  currentPath = path;
  shownAt = document.visibilityState === "hidden" ? null : Date.now();
  visibleMs = 0;
  maxScroll = 0;
  const referrer = first && document.referrer && !document.referrer.startsWith(location.origin) ? document.referrer : null;
  push({ type: "page_view", path, data: referrer ? { referrer: referrer.slice(0, 300) } : undefined });
}

/** Typing fires an action per key; one per few seconds is enough to count the use. */
const REPEAT_MS = 5_000;
let lastAction = { name: "", at: 0 };

/** Something the person did that matters to the product, by name (e.g. "completePhase"). */
export function trackAction(name: string, data?: Record<string, unknown>) {
  const now = Date.now();
  if (name === lastAction.name && now - lastAction.at < REPEAT_MS && name.startsWith("update")) return;
  lastAction = { name, at: now };
  push({ type: "action", path: currentPath || location.pathname, target: name, data });
}

const INTERACTIVE = "a, button, [role=button], [role=tab], [role=menuitem], [role=option], [role=switch], [role=checkbox], input, select, textarea, label, summary, [data-track]";

/** A short, human label for what was clicked. Never an input's value. */
function labelOf(el: Element): string {
  const h = el as HTMLElement;
  const explicit = h.dataset?.track || el.getAttribute("aria-label") || el.getAttribute("title");
  if (explicit) return explicit.trim().slice(0, 120);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const name = el.getAttribute("placeholder") || el.getAttribute("name") || el.id;
    const kind = el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase();
    return `${kind} field${name ? `: ${name}` : ""}`.slice(0, 120);
  }
  const text = (h.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 80);
  const svg = el.querySelector("svg[class*='lucide']");
  return svg ? `icon ${[...svg.classList].find((c) => c.startsWith("lucide-"))?.slice(7) ?? ""}`.trim() : el.tagName.toLowerCase();
}

/** A CSS path to the element, so the heat map can find it again on the page. */
function selectorOf(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.body && parts.length < 12) {
    if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
      parts.unshift(`#${node.id}`);
      break;
    }
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    const same = parent ? [...parent.children].filter((c) => c.tagName === node!.tagName) : [];
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
    node = parent;
  }
  if (node === document.body) parts.unshift("body");
  return parts.join(" > ").slice(0, 400);
}

function onClick(e: MouseEvent) {
  const raw = e.target instanceof Element ? e.target : null;
  if (!raw) return;
  const hit = raw.closest(INTERACTIVE);
  const el = hit ?? raw;
  if (el.closest("[data-track-ignore]")) return;
  const rect = el.getBoundingClientRect();
  const data: Record<string, unknown> = {
    sel: selectorOf(el),
    ox: rect.width ? Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 1000 : 0.5,
    oy: rect.height ? Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 1000 : 0.5,
  };
  // A click on something that is not a control: people expected it to do something.
  if (!hit && !window.getSelection()?.toString()) data.dead = true;
  push({ type: "click", path: currentPath || location.pathname, target: labelOf(el), x: Math.round(e.pageX), y: Math.round(e.pageY), data });
}

function onError(e: ErrorEvent) {
  const where = e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : "";
  push({ type: "error", path: currentPath || location.pathname, target: `${e.message || "Error"}${where}`.slice(0, 300) });
}

function onRejection(e: PromiseRejectionEvent) {
  const reason = e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : String(e.reason);
  push({ type: "error", path: currentPath || location.pathname, target: `Unhandled: ${reason}`.slice(0, 300) });
}

function onScroll() {
  maxScroll = Math.max(maxScroll, scrollDepth());
}

function onVisibility() {
  if (document.visibilityState === "hidden") {
    if (shownAt != null) visibleMs += Date.now() - shownAt;
    shownAt = null;
    flush(true);
  } else if (shownAt == null) {
    shownAt = Date.now();
  }
}

function onPageHide() {
  leavePage();
  currentPath = "";
  flush(true);
}

/** Starts tracking; returns a function that stops it. Does nothing inside a frame (the heat map's page preview). */
export function startTracking(): () => void {
  if (running || typeof window === "undefined" || window.self !== window.top) return () => {};
  running = true;
  document.addEventListener("click", onClick, { capture: true, passive: true });
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  const flusher = setInterval(() => flush(), FLUSH_MS);
  const heartbeat = setInterval(() => {
    if (document.visibilityState === "visible") push({ type: "heartbeat", path: currentPath || location.pathname });
  }, HEARTBEAT_MS);
  return () => {
    leavePage();
    flush(true);
    running = false;
    currentPath = "";
    queue = [];
    clearInterval(flusher);
    clearInterval(heartbeat);
    document.removeEventListener("click", onClick, { capture: true });
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
  };
}
