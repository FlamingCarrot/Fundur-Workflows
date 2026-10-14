import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { Db } from "@/lib/db";
import { request } from "node:https";
import { pinnedDestination, readPublicPage } from "@/lib/sourcing/public-page";
import type { LinkPreview } from "./types";

export { firstWebLink, type LinkPreview } from "./types";

type Node = DefaultTreeAdapterMap["node"];

const tidy = (v: string | undefined, max: number) => (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Reads a page's title, description, site name and picture from its head. */
export function previewFromHtml(url: string, html: string): LinkPreview | null {
  const meta = new Map<string, string>();
  let title = "";
  const stack: Node[] = [parse(html.slice(0, 400_000))];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.nodeName === "body") continue;
    if (n.nodeName === "meta" && "attrs" in n) {
      const a = Object.fromEntries(n.attrs.map((x) => [x.name.toLowerCase(), x.value]));
      const key = (a.property || a.name || "").toLowerCase();
      if (key && a.content && !meta.has(key)) meta.set(key, a.content);
    }
    if (n.nodeName === "title" && "childNodes" in n) title = n.childNodes.map((c) => ("value" in c ? c.value : "")).join("");
    if ("childNodes" in n) for (let i = n.childNodes.length - 1; i >= 0; i--) stack.push(n.childNodes[i]);
  }
  const page = new URL(url);
  let image: string | null = null;
  try {
    const raw = meta.get("og:image") || meta.get("twitter:image");
    if (raw) {
      const u = new URL(raw, page);
      image = u.protocol === "https:" ? u.href.slice(0, 2000) : null;
    }
  } catch {
    image = null;
  }
  const preview = {
    url,
    title: tidy(meta.get("og:title") || meta.get("twitter:title") || title, 300),
    description: tidy(meta.get("og:description") || meta.get("description") || meta.get("twitter:description"), 600),
    site: tidy(meta.get("og:site_name"), 200) || page.hostname.replace(/^www\./, ""),
    image,
  };
  return preview.title || preview.description ? preview : null;
}

const WEEK = 7 * 86_400_000;
const DAY = 86_400_000;

/**
 * The preview of a web address, read from the public page (never a private
 * or local address) and kept for a week; a page that can't be read is not
 * tried again for a day.
 */
export async function linkPreview(db: Db, workspaceId: string, url: string, read: typeof readPublicPage = readPublicPage): Promise<LinkPreview | null> {
  const [hit] = await db.query<{ ok: boolean; title: string | null; description: string | null; site: string | null; image: string | null; fetched_at: Date }>(
    "SELECT ok,title,description,site,image,fetched_at FROM project_chat_link_previews WHERE workspace_id=$1 AND url=$2",
    [workspaceId, url],
  );
  if (hit && Date.now() - hit.fetched_at.getTime() < (hit.ok ? WEEK : DAY))
    return hit.ok ? { url, title: hit.title ?? "", description: hit.description ?? "", site: hit.site ?? "", image: hit.image } : null;
  let preview: LinkPreview | null = null;
  try {
    const page = await read(url);
    preview = previewFromHtml(page.url, page.html);
    if (preview) preview.url = url;
  } catch {
    preview = null;
  }
  await db.query(
    `INSERT INTO project_chat_link_previews(workspace_id,url,ok,title,description,site,image,fetched_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT(workspace_id,url) DO UPDATE SET ok=EXCLUDED.ok,title=EXCLUDED.title,description=EXCLUDED.description,site=EXCLUDED.site,image=EXCLUDED.image,fetched_at=NOW()`,
    [workspaceId, url, !!preview, preview?.title ?? null, preview?.description ?? null, preview?.site ?? null, preview?.image ?? null],
  );
  return preview;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
export const MAX_PREVIEW_IMAGE_BYTES = 2 * 1024 * 1024;

type Destination = Awaited<ReturnType<typeof pinnedDestination>>;
type ImageHop = { location?: string; bytes?: Buffer; type?: string };

/** One request for a picture, to the address already checked (no DNS rebinding). */
function getImage(d: Destination, signal: AbortSignal): Promise<ImageHop> {
  return new Promise((resolve, reject) => {
    const req = request(
      d.url,
      {
        method: "GET",
        signal,
        headers: { Accept: IMAGE_TYPES.join(", "), "Accept-Encoding": "identity", "User-Agent": "Fundur-Workflows-LinkPreview/1.0" },
        lookup: (_h, opts, cb) => {
          const done = cb as (e: Error | null, a: string | { address: string; family: number }[], f?: number) => void;
          if (typeof opts === "object" && opts.all) done(null, [d.address]);
          else done(null, d.address.address, d.address.family);
        },
      },
      (res) => {
        const status = res.statusCode ?? 502;
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.resume();
          resolve({ location: res.headers.location });
          return;
        }
        const type = (res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        // Never SVG: it can carry script.
        if (status !== 200 || !IMAGE_TYPES.includes(type) || Number(res.headers["content-length"] ?? 0) > MAX_PREVIEW_IMAGE_BYTES) {
          res.destroy();
          reject(new Error("Not a picture we show"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_PREVIEW_IMAGE_BYTES) {
            res.destroy();
            req.destroy();
            reject(new Error("Picture too large"));
          } else chunks.push(c);
        });
        res.once("end", () => resolve({ bytes: Buffer.concat(chunks), type }));
        res.once("error", reject);
      },
    );
    req.once("error", reject);
    req.setTimeout(8_000, () => req.destroy());
    req.end();
  });
}

/**
 * A preview's picture, fetched by the server so the supplier never sees who
 * is looking: public https addresses only, common picture types (no SVG),
 * at most 2 MB. Null when it can't be shown.
 */
export async function previewImage(url: string, deps: { resolver?: Parameters<typeof pinnedDestination>[1]; get?: typeof getImage } = {}): Promise<{ bytes: Buffer; type: string } | null> {
  const signal = AbortSignal.timeout(12_000);
  let next = url;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const d = await pinnedDestination(next, deps.resolver);
      const got = await (deps.get ?? getImage)(d, signal);
      if (got.bytes && got.type) return { bytes: got.bytes, type: got.type };
      if (!got.location) return null;
      next = new URL(got.location, d.url).href;
    }
  } catch {
    return null;
  }
  return null;
}
