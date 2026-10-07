import { z } from "zod";

/**
 * What the browser sends about how the app is used (usage analytics). Shared
 * by the tracker in the browser and the route that stores it, so both agree
 * on the shape and the limits.
 */

export const USAGE_EVENT_TYPES = ["page_view", "page_leave", "click", "action", "error", "heartbeat"] as const;
export type UsageEventType = (typeof USAGE_EVENT_TYPES)[number];

export type Device = "phone" | "tablet" | "desktop";

/** Batches are small and frequent; anything bigger is not from our tracker. */
export const MAX_BATCH = 100;

const short = (max: number) => z.string().transform((s) => s.slice(0, max));

export const usageEventSchema = z.object({
  type: z.enum(USAGE_EVENT_TYPES),
  path: short(500),
  target: short(300).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  vw: z.number().int().min(0).max(20_000).optional(),
  vh: z.number().int().min(0).max(20_000).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  /** How long ago it happened, so a batch keeps its order and timing. */
  ageMs: z.number().int().min(0).max(86_400_000).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const usageBatchSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  events: z.array(usageEventSchema).min(1).max(MAX_BATCH),
});

export type UsageEventInput = z.input<typeof usageEventSchema>;
export type UsageBatch = z.output<typeof usageBatchSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The page with its ids taken out, so every project's phase page counts as
 * one page: /projects/harbour-house/phases/discovery → /projects/:project/phases/:phase.
 */
export function routeOf(path: string): string {
  const clean = (path.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  const parts = clean.split("/");
  const out = parts.map((seg, i) => {
    const prev = parts[i - 1];
    if (!seg) return seg;
    if (prev === "projects" && seg !== "new") return ":project";
    if (prev === "phases") return ":phase";
    if (UUID.test(seg) || /^\d{3,}$/.test(seg)) return ":id";
    return seg;
  });
  return out.join("/") || "/";
}

export function deviceOf(viewportWidth: number | undefined): Device | null {
  if (!viewportWidth) return null;
  if (viewportWidth < 640) return "phone";
  if (viewportWidth < 1024) return "tablet";
  return "desktop";
}

/** A page name a person reads, for the live stream and the advisor. */
export function routeName(route: string): string {
  const names: Record<string, string> = {
    "/": "Today",
    "/tasks": "Due list",
    "/calendar": "Calendar",
    "/timeline": "Timeline",
    "/projects": "All projects",
    "/projects/new": "New project",
    "/projects/:project": "Project",
    "/projects/:project/phases/:phase": "Phase",
    "/projects/:project/phases/:phase/complete": "Complete phase",
    "/projects/:project/brief": "Brief",
    "/projects/:project/brief/draft": "Draft the brief",
    "/projects/:project/documents": "Documents",
    "/projects/:project/plan": "Floor plan editor",
    "/projects/:project/layout": "Layout options",
    "/projects/:project/ai": "AI spend",
    "/rules": "Layout rules",
    "/settings": "AI models",
    "/settings/routing": "AI routing",
    "/settings/tickets": "Tickets",
    "/settings/improve": "Improve next",
    "/settings/usage": "Usage",
  };
  return names[route] ?? route;
}
