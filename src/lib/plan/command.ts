import type { Point } from "./geometry";

/**
 * AutoCAD's command line for the Draw tool: a command name or its alias
 * (L, PL, REC, C, A, TR, O, F…) picks a tool, a number after Offset, Fillet
 * or Chamfer sets its distance, and while drawing a point can be typed as
 * x,y (absolute), @dx,dy (from the last point), @length<angle, or a length
 * towards the pointer. POLAR and an angle sets the steps lines lock to.
 */

export type CommandTool = "line" | "polyline" | "rectangle" | "circle" | "arc" | "polygon" | "ellipse" | "text" | "leader" | "table" | "trim" | "extend" | "offset" | "fillet" | "chamfer" | "break" | "stretch" | "match" | "hatch" | "dimlinear" | "dimangular" | "dimradius" | "dimdiameter" | "dimchain";

export type PointSpec = { abs: Point } | { rel: Point } | { polar: { length: number; angle: number } } | { length: number };

export type Command =
  | { kind: "tool"; tool: CommandTool; amount?: number }
  | { kind: "action"; action: "explode" | "join" | "close" | "undo-point" }
  | { kind: "point"; spec: PointSpec }
  /** POLAR 15: lines lock to multiples of this angle. */
  | { kind: "polar"; step: number }
  | { kind: "error"; message: string };

const ALIASES: Record<string, CommandTool> = {
  l: "line",
  line: "line",
  pl: "polyline",
  pline: "polyline",
  polyline: "polyline",
  rec: "rectangle",
  rect: "rectangle",
  rectang: "rectangle",
  rectangle: "rectangle",
  c: "circle",
  circle: "circle",
  a: "arc",
  arc: "arc",
  pol: "polygon",
  polygon: "polygon",
  el: "ellipse",
  ellipse: "ellipse",
  t: "text",
  dt: "text",
  mt: "text",
  text: "text",
  mtext: "text",
  dtext: "text",
  tb: "table",
  table: "table",
  le: "leader",
  ql: "leader",
  leader: "leader",
  qleader: "leader",
  mleader: "leader",
  mld: "leader",
  tr: "trim",
  trim: "trim",
  ex: "extend",
  extend: "extend",
  o: "offset",
  offset: "offset",
  f: "fillet",
  fillet: "fillet",
  cha: "chamfer",
  chamfer: "chamfer",
  br: "break",
  break: "break",
  ma: "match",
  matchprop: "match",
  painter: "match",
  s: "stretch",
  str: "stretch",
  stretch: "stretch",
  dli: "dimlinear",
  dimlinear: "dimlinear",
  dim: "dimlinear",
  dan: "dimangular",
  dimangular: "dimangular",
  dra: "dimradius",
  dimradius: "dimradius",
  ddi: "dimdiameter",
  dimdiameter: "dimdiameter",
  dco: "dimchain",
  dimcontinue: "dimchain",
  h: "hatch",
  bh: "hatch",
  hatch: "hatch",
};

const ACTIONS: Record<string, "explode" | "join" | "close" | "undo-point"> = {
  x: "explode",
  explode: "explode",
  j: "join",
  join: "join",
  close: "close",
  cl: "close",
  u: "undo-point",
  undo: "undo-point",
};

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;

/** Reads what was typed on the command line. */
export function parseCommand(input: string): Command {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return { kind: "error", message: "Type a command, like L for a line, or a point." };
  let m = text.match(new RegExp(`^@\\s*(${NUM})\\s*<\\s*(${NUM})$`));
  if (m) return { kind: "point", spec: { polar: { length: Number(m[1]), angle: Number(m[2]) } } };
  m = text.match(new RegExp(`^@\\s*(${NUM})\\s*,\\s*(${NUM})$`));
  if (m) return { kind: "point", spec: { rel: { x: Number(m[1]), y: Number(m[2]) } } };
  m = text.match(new RegExp(`^(${NUM})\\s*,\\s*(${NUM})$`));
  if (m) return { kind: "point", spec: { abs: { x: Number(m[1]), y: Number(m[2]) } } };
  m = text.match(new RegExp(`^(${NUM})$`));
  if (m) {
    const length = Number(m[1]);
    return length > 0 ? { kind: "point", spec: { length } } : { kind: "error", message: "A length is more than 0." };
  }
  m = text.match(new RegExp(`^([a-z]+)(?: (${NUM}))?$`));
  if (m && (m[1] === "polar" || m[1] === "polarang")) {
    const step = Number(m[2]);
    if (m[2] == null || !(step >= 1 && step <= 90)) return { kind: "error", message: "Type POLAR and an angle step from 1 to 90, like POLAR 15." };
    return { kind: "polar", step };
  }
  if (m) {
    const tool = ALIASES[m[1]];
    if (tool) {
      if (m[2] == null) return { kind: "tool", tool };
      const amount = Number(m[2]);
      if (tool !== "offset" && tool !== "fillet" && tool !== "chamfer" && tool !== "polygon") return { kind: "error", message: `${m[1].toUpperCase()} does not take a number.` };
      if (!(amount >= 0) || (tool !== "fillet" && amount === 0)) return { kind: "error", message: "That number needs to be more than 0." };
      return { kind: "tool", tool, amount };
    }
    const action = ACTIONS[m[1]];
    if (action && m[2] == null) return { kind: "action", action };
  }
  return { kind: "error", message: `"${input.trim()}" is not a command. Try L, PL, REC, C, A, TR, EX, O, F, H, DLI, or a point like @500,0.` };
}

/**
 * Where a typed point lands. `last` is the last point clicked (relative and
 * polar points need one); a bare length runs from it towards `towards`.
 */
export function resolvePoint(spec: PointSpec, last: Point | undefined, towards: Point | null): Point | null {
  if ("abs" in spec) return spec.abs;
  if (!last) return null;
  if ("rel" in spec) return { x: last.x + spec.rel.x, y: last.y + spec.rel.y };
  if ("polar" in spec) {
    const a = (spec.polar.angle * Math.PI) / 180;
    return { x: last.x + spec.polar.length * Math.cos(a), y: last.y + spec.polar.length * Math.sin(a) };
  }
  const to = towards ?? { x: last.x + 1, y: last.y };
  const d = Math.hypot(to.x - last.x, to.y - last.y);
  const u = d < 1e-6 ? { x: 1, y: 0 } : { x: (to.x - last.x) / d, y: (to.y - last.y) / d };
  return { x: last.x + u.x * spec.length, y: last.y + u.y * spec.length };
}

/** The commands, for the command line's help. */
export const COMMAND_HELP: { keys: string; what: string }[] = [
  { keys: "L, PL, REC, C, A, POL, EL", what: "Line, polyline, rectangle, circle, arc, polygon, ellipse" },
  { keys: "T, LE, H", what: "Text, leader, hatch" },
  { keys: "TR, EX, O 100, F 50, CHA 20, BR", what: "Trim, extend, offset, fillet, chamfer, break (with a distance or radius)" },
  { keys: "DLI, DAN, DRA, DDI, DCO", what: "Linear, angle, radius, diameter and chained dimensions" },
  { keys: "X, J", what: "Explode or join the selected shape" },
  { keys: "x,y  @dx,dy  @len<angle  len", what: "A point: absolute, from the last point, by length and angle, or a length towards the pointer" },
  { keys: "C (while drawing a polyline), U", what: "Close it, take back the last point" },
];
