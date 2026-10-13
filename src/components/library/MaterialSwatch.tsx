"use client";

import { useMemo } from "react";
import type { Material } from "@/lib/blueprints/types";
import { swatchUrl } from "@/components/plan/three/textures";

const urls = new Map<string, string>();

/** A material's swatch: its texture or pattern, drawn once and kept. */
export function MaterialSwatch({ material, size = 28 }: { material: Material | undefined; size?: number }) {
  const key = material ? `${material.id}@${material.revision}:${material.color}:${material.pattern}:${material.image?.length ?? 0}` : "";
  // Drawn on a canvas, so only in the browser; the colour shows until then.
  const url = useMemo(() => {
    if (!material || typeof document === "undefined") return "";
    const hit = urls.get(key);
    if (hit) return hit;
    const made = swatchUrl(material);
    if (urls.size > 500) urls.clear();
    urls.set(key, made);
    return made;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <span
      className="mat-swatch"
      aria-hidden
      style={{ width: size, height: size, backgroundColor: material?.color ?? "transparent", backgroundImage: url ? `url(${url})` : undefined, opacity: material?.opacity && material.opacity < 1 ? 0.6 : 1 }}
    />
  );
}
