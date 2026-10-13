"use client";

import { memo } from "react";
import { blueprintPreview } from "@/lib/blueprints/preview";
import type { Resolver } from "@/lib/blueprints/resolve";
import type { Blueprint } from "@/lib/blueprints/types";

/** A blueprint's little isometric picture. */
export const BlueprintThumb = memo(function BlueprintThumb({ lib, blueprint, size = 72, clay = false }: { lib: Resolver; blueprint: Blueprint; size?: number; clay?: boolean }) {
  const preview = blueprintPreview(lib, blueprint, clay);
  return (
    <svg viewBox={preview.viewBox} width={size} height={size} aria-hidden className="bp-thumb" preserveAspectRatio="xMidYMid meet">
      {preview.faces.map((f, i) => (
        <polygon key={i} points={f.points} fill={f.fill} stroke="rgba(30,32,30,0.35)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      ))}
    </svg>
  );
});
