import sharp from "sharp";
import type { MaterialBody } from "@/lib/blueprints/schema";
import type { MaterialCategory } from "@/lib/blueprints/types";

/**
 * Free textures from Poly Haven (polyhaven.com), whose textures are CC0: free
 * for any use, no credit needed (it is still given). The server searches its
 * catalogue and brings one texture in as a small tiled image kept in the
 * practice's library, so plans never depend on a third party being up.
 */

export const FREE_SOURCE = { name: "Poly Haven", licence: "CC0" } as const;
const API = "https://api.polyhaven.com";
const ALLOWED_FILES = new Set(["dl.polyhaven.org"]);
const HEADERS = { "User-Agent": "Fundur (interior design studio software)" };
/** Textures in the library are kept small: enough to read as the material at room scale. */
export const TEXTURE_PX = 512;
const MAX_DOWNLOAD = 12 * 1024 * 1024;

export interface FreeTexture {
  id: string;
  name: string;
  thumb: string;
  categories: string[];
  /** The real size the image covers, mm. */
  tile: number;
}

interface CatalogueEntry {
  name?: string;
  categories?: string[];
  tags?: string[];
  dimensions?: number[];
  download_count?: number;
}

let catalogue: { at: number; list: (FreeTexture & { words: string; downloads: number })[] } | null = null;

export class TextureSourceError extends Error {}

async function getJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new TextureSourceError("The free texture library could not be reached. Try again in a moment.");
  }
  if (!res.ok) throw new TextureSourceError("The free texture library could not be reached. Try again in a moment.");
  return res.json();
}

export const thumbOf = (id: string) => `https://cdn.polyhaven.com/asset_img/thumbs/${encodeURIComponent(id)}.png?width=256&height=256`;

async function list(fetchImpl: typeof fetch) {
  if (catalogue && Date.now() - catalogue.at < 6 * 3_600_000) return catalogue.list;
  const raw = (await getJson(fetchImpl, `${API}/assets?t=textures`)) as Record<string, CatalogueEntry>;
  if (!raw || typeof raw !== "object") throw new TextureSourceError("The free texture library sent something unexpected.");
  const entries = Object.entries(raw)
    .filter(([id, a]) => /^[a-z0-9_-]{1,80}$/i.test(id) && a && typeof a === "object")
    .map(([id, a]) => {
      const dims = Array.isArray(a.dimensions) ? a.dimensions.filter((n) => typeof n === "number" && n > 0) : [];
      return {
        id,
        name: String(a.name ?? id).slice(0, 120),
        thumb: thumbOf(id),
        categories: (a.categories ?? []).filter((c): c is string => typeof c === "string").slice(0, 10),
        tile: dims.length ? Math.max(100, Math.min(20_000, Math.round(dims[0]))) : 2_000,
        words: [id, a.name, ...(a.categories ?? []), ...(a.tags ?? [])].join(" ").toLowerCase(),
        downloads: Number(a.download_count) || 0,
      };
    });
  catalogue = { at: Date.now(), list: entries };
  return entries;
}

/** Textures matching every word, most used first. */
export async function searchFree(query: string, fetchImpl: typeof fetch = fetch, limit = 48): Promise<FreeTexture[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const all = await list(fetchImpl);
  return all
    .filter((t) => words.every((w) => t.words.includes(w)))
    .sort((a, b) => b.downloads - a.downloads)
    .slice(0, limit)
    .map(({ id, name, thumb, categories, tile }) => ({ id, name, thumb, categories, tile }));
}

export function categoryFor(words: string): MaterialCategory {
  const w = words.toLowerCase();
  if (/wood|plank|parquet|timber|bark/.test(w)) return "Wood";
  if (/tile|mosaic/.test(w)) return "Tile";
  if (/concrete|asphalt|cement/.test(w)) return "Concrete";
  if (/marble|stone|rock|granite|travertine|terrazzo|cobble|brick|slate/.test(w)) return "Stone";
  if (/fabric|carpet|cloth|leather|textile|rug|linen/.test(w)) return "Fabric";
  if (/metal|steel|iron|rust|copper|brass|alumin/.test(w)) return "Metal";
  if (/plaster|paint|wall/.test(w)) return "Paint";
  if (/plastic|rubber/.test(w)) return "Plastic";
  return "Other";
}

/** The colour map's 1k JPEG among a Poly Haven asset's files. */
export function diffuseUrl(files: unknown): string | null {
  if (!files || typeof files !== "object") return null;
  const maps = files as Record<string, Record<string, Record<string, { url?: string }>>>;
  const key = Object.keys(maps).find((k) => /^(diffuse|diff|albedo|color|col)$/i.test(k)) ?? Object.keys(maps).find((k) => /diff|albedo|colou?r/i.test(k));
  if (!key) return null;
  const sizes = maps[key];
  for (const size of ["1k", "2k"]) {
    const url = sizes?.[size]?.jpg?.url ?? sizes?.[size]?.png?.url;
    if (typeof url === "string") return url;
  }
  return null;
}

/** A small tiled JPEG and its average colour, from any image's bytes. */
export async function toTexture(bytes: Uint8Array): Promise<{ image: string; color: string }> {
  const image = sharp(Buffer.from(bytes), { limitInputPixels: 50_000_000 });
  let quality = 82;
  let out = await image.clone().resize(TEXTURE_PX, TEXTURE_PX, { fit: "cover" }).jpeg({ quality, mozjpeg: true }).toBuffer();
  while (out.length > 280_000 && quality > 40) {
    quality -= 12;
    out = await image.clone().resize(TEXTURE_PX, TEXTURE_PX, { fit: "cover" }).jpeg({ quality, mozjpeg: true }).toBuffer();
  }
  const { channels } = await sharp(out).stats();
  const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return { image: `data:image/jpeg;base64,${out.toString("base64")}`, color: `#${hex(channels[0].mean)}${hex(channels[1].mean)}${hex(channels[2].mean)}` };
}

async function download(fetchImpl: typeof fetch, url: string): Promise<Uint8Array> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TextureSourceError("That texture has no image to bring in.");
  }
  if (parsed.protocol !== "https:" || !ALLOWED_FILES.has(parsed.hostname)) throw new TextureSourceError("That texture has no image to bring in.");
  let res: Response;
  try {
    res = await fetchImpl(parsed.toString(), { headers: HEADERS, redirect: "error", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new TextureSourceError("The texture could not be downloaded. Try again in a moment.");
  }
  if (!res.ok) throw new TextureSourceError("The texture could not be downloaded. Try again in a moment.");
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_DOWNLOAD) throw new TextureSourceError("That texture is too large to bring in.");
  const buffer = new Uint8Array(await res.arrayBuffer());
  if (buffer.length > MAX_DOWNLOAD) throw new TextureSourceError("That texture is too large to bring in.");
  return buffer;
}

/** A free texture as a material body, ready to keep in the practice's library. */
export async function importFree(id: string, fetchImpl: typeof fetch = fetch): Promise<MaterialBody> {
  if (!/^[a-z0-9_-]{1,80}$/i.test(id)) throw new TextureSourceError("Choose a texture from the list.");
  const entry = (await list(fetchImpl)).find((t) => t.id === id);
  if (!entry) throw new TextureSourceError("That texture is no longer in the free library.");
  const url = diffuseUrl(await getJson(fetchImpl, `${API}/files/${encodeURIComponent(id)}`));
  if (!url) throw new TextureSourceError("That texture has no colour map to bring in.");
  const { image, color } = await toTexture(await download(fetchImpl, url));
  const category = categoryFor(entry.words);
  return {
    name: entry.name,
    category,
    color,
    roughness: category === "Metal" ? 0.4 : category === "Tile" ? 0.35 : 0.75,
    metalness: category === "Metal" ? 0.8 : 0,
    image,
    tile: entry.tile,
    source: { ...FREE_SOURCE, url: `https://polyhaven.com/a/${encodeURIComponent(id)}` },
  };
}

/** Clears the cached catalogue (tests). */
export function forgetCatalogue() {
  catalogue = null;
}
