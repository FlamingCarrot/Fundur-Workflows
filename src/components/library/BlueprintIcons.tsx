import React from "react";
import {
  Pyramid as LucidePyramid,
  Cylinder as LucideCylinder,
  Box as LucideBox,
} from "lucide-react";

export interface BlueprintIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  className?: string;
  strokeWidth?: number | string;
}

/**
 * 3D Torus / Ring Icon
 */
export function TorusIcon({ size = 22, strokeWidth = 2, className, ...props }: BlueprintIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <ellipse cx="12" cy="12" rx="9.5" ry="6.5" />
      <ellipse cx="12" cy="11.5" rx="3.8" ry="2.2" />
      <path d="M4 12.5c1.2 3.2 4.5 5 8 5s6.8-1.8 8-5" opacity="0.35" />
    </svg>
  );
}

/**
 * 3D Pyramid Icon (Wireframe apex with faceted front fold)
 */
export function PyramidIcon({ size = 22, strokeWidth = 2, className, ...props }: BlueprintIconProps) {
  return <LucidePyramid size={size} strokeWidth={strokeWidth} className={className} {...props} />;
}

/**
 * 3D Capsule / Pill Icon (Cylindrical body with hemispherical caps and dividing seam)
 */
export function CapsuleIcon({ size = 22, strokeWidth = 2, className, ...props }: BlueprintIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <rect x="7" y="2.5" width="10" height="19" rx="5" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <path d="M7 7.5c2 1 8 1 10 0" opacity="0.4" />
      <path d="M7 16.5c2 1 8 1 10 0" opacity="0.4" />
    </svg>
  );
}

/**
 * 3D Pipe / Hollow Tube Icon (Cylinder with wall thickness bore ellipse at top)
 */
export function PipeIcon({ size = 22, strokeWidth = 2, className, ...props }: BlueprintIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <ellipse cx="12" cy="5.5" rx="8.5" ry="3.2" />
      <ellipse cx="12" cy="5.5" rx="4.5" ry="1.7" />
      <path d="M3.5 5.5v13c0 1.8 3.8 3.2 8.5 3.2s8.5-1.4 8.5-3.2v-13" />
    </svg>
  );
}

/**
 * 3D Hexagonal Column / Prism Icon (Isometric top hexagon with 3 vertical facet panels)
 */
export function HexColumnIcon({ size = 22, strokeWidth = 2, className, ...props }: BlueprintIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path d="M12 2.5 18.5 6v5L12 14.5 5.5 11V6Z" />
      <path d="M5.5 11v6.5L12 21l6.5-3.5V11" />
      <path d="M12 14.5V21" />
    </svg>
  );
}

/**
 * 3D Hemispherical Dome Icon (Elliptical base with spherical arch meridian ribs)
 */
export function DomeIcon({ size = 22, strokeWidth = 2, className, ...props }: BlueprintIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <ellipse cx="12" cy="17.5" rx="9" ry="3.5" />
      <path d="M3 17.5C3 9 7 3.5 12 3.5s9 5.5 9 14" />
      <path d="M12 3.5v17.5" />
      <path d="M12 3.5c3.2 0 5.8 4.5 5.8 14" />
      <path d="M12 3.5c-3.2 0-5.8 4.5-5.8 14" />
    </svg>
  );
}

/**
 * 3D Stairs / Steps Icon (Ascending stepped risers and treads)
 */
export function StairsIcon({ size = 22, strokeWidth = 2, className, ...props }: BlueprintIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path d="M4 20h16V4h-4v4h-4v4H8v4H4v4Z" />
      <path d="M8 16v4" opacity="0.35" />
      <path d="M12 12v8" opacity="0.35" />
      <path d="M16 8v12" opacity="0.35" />
    </svg>
  );
}

/**
 * 3D Curved Architectural Arch Icon (Roman semicircular portal opening)
 */
export function CurvedArchIcon({ size = 22, strokeWidth = 2, className, ...props }: BlueprintIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path d="M4 21V11a8 8 0 0 1 16 0v10" />
      <path d="M8 21V11a4 4 0 0 1 8 0v10" />
      <line x1="2" y1="21" x2="22" y2="21" />
    </svg>
  );
}

/**
 * 3D Sphere Wireframe Icon (Circle with equatorial perspective ellipse)
 */
export function SphereIcon({ size = 22, strokeWidth = 2, className, ...props }: BlueprintIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <circle cx="12" cy="12" r="9.5" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.5" />
      <path d="M12 2.5a9.5 9.5 0 0 1 0 19" opacity="0.4" strokeDasharray="2 2" />
    </svg>
  );
}

/**
 * 3D Wedge Icon (Isometric sloped ramp with vertical back)
 */
export function WedgeIcon({ size = 22, strokeWidth = 2, className, ...props }: BlueprintIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path d="m3 19 12 2 6-5-12-2z" opacity="0.25" />
      <path d="M3 19 9 5l12 2-6 14L3 19Z" />
      <path d="M9 5v11l6 5" />
      <path d="M15 21V7" opacity="0.5" />
    </svg>
  );
}

export function CylinderIcon({ size = 22, strokeWidth = 2, className, ...props }: BlueprintIconProps) {
  return <LucideCylinder size={size} strokeWidth={strokeWidth} className={className} {...props} />;
}

/**
 * Helper to get the representative icon for any primitive key
 */
export function getPrimitiveIcon(key: string, size = 22): React.ReactNode {
  switch (key) {
    case "torus":
      return <TorusIcon size={size} />;
    case "pyramid":
      return <PyramidIcon size={size} />;
    case "capsule":
      return <CapsuleIcon size={size} />;
    case "pipe":
      return <PipeIcon size={size} />;
    case "prism":
      return <HexColumnIcon size={size} />;
    case "dome":
      return <DomeIcon size={size} />;
    case "stairs":
      return <StairsIcon size={size} />;
    case "arch":
      return <CurvedArchIcon size={size} />;
    default:
      return <LucideBox size={size} />;
  }
}
