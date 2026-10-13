import * as THREE from "three";
import type { Material, MaterialPattern } from "@/lib/blueprints/types";

/**
 * Textures for materials. Patterns are drawn on a canvas in the browser, so
 * the defaults need no download and carry no licence; image textures (from the
 * free library, an upload or the AI) are loaded once and shared.
 */

const SIZE = 512;

/** A repeatable random number source, so a pattern looks the same every time. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 4_294_967_296;
  };
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + k)));
  return `#${c.getHexString()}`;
}

function noise(ctx: CanvasRenderingContext2D, rand: () => number, amount: number, count = 9_000, size = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${amount * rand()})` : `rgba(0,0,0,${amount * rand()})`;
    ctx.fillRect(rand() * SIZE, rand() * SIZE, size, size);
  }
}

function wood(ctx: CanvasRenderingContext2D, color: string, rand: () => number) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let y = 0; y < SIZE; y += 2) {
    const wave = Math.sin(y / 23 + rand() * 0.4) * 0.5 + Math.sin(y / 7) * 0.2;
    ctx.fillStyle = shade(color, -0.05 + wave * 0.04 + (rand() - 0.5) * 0.03);
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, y, SIZE, 2);
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 40; i++) {
    const y = rand() * SIZE;
    ctx.strokeStyle = shade(color, -0.12);
    ctx.globalAlpha = 0.25 + rand() * 0.3;
    ctx.lineWidth = 0.6 + rand() * 1.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= SIZE; x += 32) ctx.lineTo(x, y + Math.sin(x / 60 + i) * 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

const PATTERNS: Record<MaterialPattern, (ctx: CanvasRenderingContext2D, color: string, rand: () => number) => void> = {
  plain: (ctx, color, rand) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    noise(ctx, rand, 0.03);
  },
  wood,
  planks: (ctx, color, rand) => {
    wood(ctx, color, rand);
    const rows = 6;
    for (let r = 0; r < rows; r++) {
      const y = (r * SIZE) / rows;
      ctx.fillStyle = shade(color, (rand() - 0.5) * 0.08);
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, y, SIZE, SIZE / rows);
      ctx.globalAlpha = 1;
      ctx.fillStyle = shade(color, -0.25);
      ctx.fillRect(0, y, SIZE, 2);
      const joint = rand() * SIZE;
      ctx.fillRect(joint, y, 2, SIZE / rows);
    }
  },
  herringbone: (ctx, color, rand) => {
    ctx.fillStyle = shade(color, -0.2);
    ctx.fillRect(0, 0, SIZE, SIZE);
    const w = SIZE / 8;
    const l = w * 4;
    for (let i = -8; i < 16; i++)
      for (let j = -8; j < 16; j++) {
        const x = i * w * 2 + j * w;
        const y = j * w - i * w * 0;
        ctx.save();
        ctx.translate(x, y + i * w * 2);
        ctx.rotate(((j + i) % 2 ? 1 : -1) * Math.PI * 0.25);
        ctx.fillStyle = shade(color, (rand() - 0.5) * 0.1);
        ctx.fillRect(1, 1, l - 2, w - 2);
        ctx.restore();
      }
  },
  tiles: (ctx, color, rand) => {
    ctx.fillStyle = shade(color, -0.18);
    ctx.fillRect(0, 0, SIZE, SIZE);
    const n = 2;
    const s = SIZE / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = shade(color, (rand() - 0.5) * 0.04);
        ctx.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
      }
    noise(ctx, rand, 0.02);
  },
  brick: (ctx, color, rand) => {
    ctx.fillStyle = "#cfc8bb";
    ctx.fillRect(0, 0, SIZE, SIZE);
    const rows = 8;
    const h = SIZE / rows;
    const w = SIZE / 2;
    for (let r = 0; r < rows; r++)
      for (let c = -1; c < 3; c++) {
        const x = c * w + (r % 2 ? w / 2 : 0);
        ctx.fillStyle = shade(color, (rand() - 0.5) * 0.14);
        ctx.fillRect(x + 4, r * h + 4, w - 8, h - 8);
      }
    noise(ctx, rand, 0.06, 14_000);
  },
  concrete: (ctx, color, rand) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 260; i++) {
      const r = 10 + rand() * 60;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      const tone = shade(color, (rand() - 0.5) * 0.1);
      g.addColorStop(0, tone);
      g.addColorStop(1, "transparent");
      ctx.save();
      ctx.translate(rand() * SIZE, rand() * SIZE);
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    noise(ctx, rand, 0.06, 20_000, 1.5);
  },
  marble: (ctx, color, rand) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let v = 0; v < 14; v++) {
      ctx.strokeStyle = shade(color, -0.2 - rand() * 0.2);
      ctx.globalAlpha = 0.15 + rand() * 0.35;
      ctx.lineWidth = 0.5 + rand() * 2;
      ctx.beginPath();
      let x = rand() * SIZE;
      let y = 0;
      ctx.moveTo(x, y);
      while (y < SIZE) {
        x += (rand() - 0.5) * 40;
        y += 10 + rand() * 30;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
  fabric: (ctx, color, rand) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < SIZE; i += 3) {
      ctx.fillStyle = shade(color, 0.04);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(i, 0, 1, SIZE);
      ctx.fillStyle = shade(color, -0.05);
      ctx.fillRect(0, i, SIZE, 1);
    }
    ctx.globalAlpha = 1;
    noise(ctx, rand, 0.05, 16_000, 1);
  },
  carpet: (ctx, color, rand) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    noise(ctx, rand, 0.12, 40_000, 2);
    ctx.fillStyle = shade(color, -0.12);
    ctx.fillRect(0, 0, SIZE, 2);
    ctx.fillRect(0, 0, 2, SIZE);
  },
  metal: (ctx, color, rand) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      ctx.fillStyle = shade(color, (rand() - 0.5) * 0.06);
      ctx.globalAlpha = 0.6;
      ctx.fillRect(0, y, SIZE, 1);
    }
    ctx.globalAlpha = 1;
  },
  terrazzo: (ctx, color, rand) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    const chips = ["#b9a998", "#8f8b84", "#e8e2d6", "#c27a5a", "#6f7a72"];
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = chips[Math.floor(rand() * chips.length)];
      ctx.beginPath();
      const x = rand() * SIZE;
      const y = rand() * SIZE;
      const r = 1 + rand() * 6;
      ctx.ellipse(x, y, r, r * (0.5 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

const cache = new Map<string, THREE.Texture>();

/** The texture a material shows, or null for plain colour. Shared by every mesh using it. */
export function textureFor(material: Material, onLoad: () => void): THREE.Texture | null {
  const key = material.image ? `img:${material.image.slice(0, 200)}:${material.image.length}` : material.pattern && material.pattern !== "plain" ? `pat:${material.pattern}:${material.color}` : null;
  if (!key) return null;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  let texture: THREE.Texture;
  if (material.image) {
    texture = new THREE.TextureLoader().load(material.image, () => onLoad());
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const seed = [...material.id].reduce((n, c) => n * 31 + c.charCodeAt(0), 7);
    PATTERNS[material.pattern!](ctx, material.color, rng(seed));
    texture = new THREE.CanvasTexture(canvas);
  }
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (cache.size > 120) {
    for (const [k, t] of cache) {
      t.dispose();
      cache.delete(k);
      if (cache.size <= 80) break;
    }
  }
  cache.set(key, texture);
  return texture;
}

/** A swatch image of a material, for pickers. */
export function swatchUrl(material: Material, size = 96): string {
  if (material.image) return material.image;
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const seed = [...material.id].reduce((n, c) => n * 31 + c.charCodeAt(0), 7);
  PATTERNS[material.pattern ?? "plain"](ctx, material.color, rng(seed));
  const out = document.createElement("canvas");
  out.width = out.height = size;
  out.getContext("2d")!.drawImage(canvas, 0, 0, size, size);
  return out.toDataURL("image/png");
}
