/**
 * A small vector PDF writer: pages drawn in millimetres with lines, filled
 * shapes, arcs, text in Helvetica and JPEG images. Hand-written like the
 * image PDF, so drawing sheets come out in the browser, on the server and in
 * tests without a library, and print sharp at any size.
 */

const enc = new TextEncoder();
const PT = 72 / 25.4;
const f = (n: number) => (Math.round(n * PT * 100) / 100).toString();

/** PDF strings in WinAnsi: keep printable ASCII, swap the rest. */
export function pdfText(s: string): string {
  const plain = s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/×/g, "x")
    .replace(/²/g, "2")
    .replace(/°/g, " deg")
    .replace(/[^\x20-\x7e]/g, "");
  return plain.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** Roughly how wide Helvetica text is, in mm, for centring and fitting. */
export function textWidth(text: string, size: number, bold = false): number {
  let units = 0;
  for (const ch of text) units += /[il.,:;'|!]/.test(ch) ? 0.26 : /[mwMW@]/.test(ch) ? 0.85 : /[A-Z0-9]/.test(ch) ? 0.66 : ch === " " ? 0.28 : 0.53;
  return units * size * (bold ? 1.05 : 1);
}

export interface Pt {
  x: number;
  y: number;
}

export class PdfPageBuilder {
  ops: string[] = [];
  images: { name: string; jpeg: Uint8Array; width: number; height: number }[] = [];
  constructor(
    public width: number,
    public height: number,
  ) {}
  private colour(c: [number, number, number], stroke: boolean) {
    this.ops.push(`${c.map((v) => (v / 255).toFixed(3)).join(" ")} ${stroke ? "RG" : "rg"}`);
  }
  lineWidth(mm: number) {
    this.ops.push(`${f(mm)} w`);
    return this;
  }
  stroke(c: [number, number, number] = [0, 0, 0]) {
    this.colour(c, true);
    return this;
  }
  fill(c: [number, number, number]) {
    this.colour(c, false);
    return this;
  }
  dash(on: number[] = []) {
    this.ops.push(`[${on.map(f).join(" ")}] 0 d`);
    return this;
  }
  private path(points: Pt[], close: boolean) {
    if (points.length < 2) return false;
    this.ops.push(`${f(points[0].x)} ${f(points[0].y)} m`);
    for (const p of points.slice(1)) this.ops.push(`${f(p.x)} ${f(p.y)} l`);
    if (close) this.ops.push("h");
    return true;
  }
  line(a: Pt, b: Pt) {
    this.ops.push(`${f(a.x)} ${f(a.y)} m ${f(b.x)} ${f(b.y)} l S`);
    return this;
  }
  polyline(points: Pt[], close = false) {
    if (this.path(points, close)) this.ops.push("S");
    return this;
  }
  polygon(points: Pt[], mode: "fill" | "stroke" | "both" = "fill") {
    if (this.path(points, true)) this.ops.push(mode === "fill" ? "f" : mode === "stroke" ? "S" : "B");
    return this;
  }
  rect(x: number, y: number, w: number, h: number, mode: "fill" | "stroke" | "both" = "stroke") {
    this.ops.push(`${f(x)} ${f(y)} ${f(w)} ${f(h)} re ${mode === "fill" ? "f" : mode === "stroke" ? "S" : "B"}`);
    return this;
  }
  /** An arc about `c` from angle `a0` to `a1` (radians, anticlockwise), as Bézier curves. */
  arc(c: Pt, r: number, a0: number, a1: number) {
    let sweep = a1 - a0;
    const parts = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    sweep /= parts;
    const k = (4 / 3) * Math.tan(sweep / 4);
    let a = a0;
    this.ops.push(`${f(c.x + r * Math.cos(a))} ${f(c.y + r * Math.sin(a))} m`);
    for (let i = 0; i < parts; i++) {
      const b = a + sweep;
      const p1 = { x: c.x + r * (Math.cos(a) - k * Math.sin(a)), y: c.y + r * (Math.sin(a) + k * Math.cos(a)) };
      const p2 = { x: c.x + r * (Math.cos(b) + k * Math.sin(b)), y: c.y + r * (Math.sin(b) - k * Math.cos(b)) };
      this.ops.push(`${f(p1.x)} ${f(p1.y)} ${f(p2.x)} ${f(p2.y)} ${f(c.x + r * Math.cos(b))} ${f(c.y + r * Math.sin(b))} c`);
      a = b;
    }
    this.ops.push("S");
    return this;
  }
  circle(c: Pt, r: number, mode: "fill" | "stroke" = "stroke") {
    const k = 0.5523 * r;
    this.ops.push(
      `${f(c.x + r)} ${f(c.y)} m ${f(c.x + r)} ${f(c.y + k)} ${f(c.x + k)} ${f(c.y + r)} ${f(c.x)} ${f(c.y + r)} c ` +
        `${f(c.x - k)} ${f(c.y + r)} ${f(c.x - r)} ${f(c.y + k)} ${f(c.x - r)} ${f(c.y)} c ` +
        `${f(c.x - r)} ${f(c.y - k)} ${f(c.x - k)} ${f(c.y - r)} ${f(c.x)} ${f(c.y - r)} c ` +
        `${f(c.x + k)} ${f(c.y - r)} ${f(c.x + r)} ${f(c.y - k)} ${f(c.x + r)} ${f(c.y)} c ${mode === "fill" ? "f" : "S"}`,
    );
    return this;
  }
  /** Text with its baseline at `at`; `align` places it left of, about or right of the point; `angle` in radians. */
  text(at: Pt, value: string, size: number, options: { bold?: boolean; align?: "left" | "centre" | "right"; angle?: number; colour?: [number, number, number] } = {}) {
    const w = textWidth(value, size, options.bold);
    const shift = options.align === "centre" ? -w / 2 : options.align === "right" ? -w : 0;
    const a = options.angle ?? 0;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = at.x + shift * c;
    const y = at.y + shift * s;
    const colour = options.colour ?? [30, 30, 28];
    this.ops.push(
      `BT /${options.bold ? "F2" : "F1"} ${f(size)} Tf ${colour.map((v) => (v / 255).toFixed(3)).join(" ")} rg ${c.toFixed(4)} ${s.toFixed(4)} ${(-s).toFixed(4)} ${c.toFixed(4)} ${f(x)} ${f(y)} Tm (${pdfText(value)}) Tj ET`,
    );
    return this;
  }
  image(jpeg: Uint8Array, px: { width: number; height: number }, x: number, y: number, w: number, h: number) {
    const name = `Im${this.images.length}`;
    this.images.push({ name, jpeg, width: px.width, height: px.height });
    this.ops.push(`q ${f(w)} 0 0 ${f(h)} ${f(x)} ${f(y)} cm /${name} Do Q`);
    return this;
  }
  save() {
    this.ops.push("q");
    return this;
  }
  restore() {
    this.ops.push("Q");
    return this;
  }
  /** Clips what follows to a polygon until `restore`. */
  clipPolygon(points: Pt[]) {
    if (this.path(points, true)) this.ops.push("W n");
    return this;
  }
  /** Clips what follows to a rectangle until `restore`. */
  clip(x: number, y: number, w: number, h: number) {
    this.ops.push(`${f(x)} ${f(y)} ${f(w)} ${f(h)} re W n`);
    return this;
  }
}

export function buildPdf(pages: PdfPageBuilder[], title?: string): Uint8Array {
  if (!pages.length) throw new Error("There is nothing to print.");
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push("\nendobj\n");
  };
  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  // 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, 5 info, then each page, its contents and its images.
  let next = 6;
  const layout = pages.map((p) => {
    const ids = { page: next, content: next + 1, images: p.images.map((_, i) => next + 2 + i) };
    next += 2 + p.images.length;
    return { p, ids };
  });
  object(1, () => push(`<< /Type /Catalog /Pages 2 0 R >>`));
  object(2, () => push(`<< /Type /Pages /Kids [${layout.map((l) => `${l.ids.page} 0 R`).join(" ")}] /Count ${layout.length} >>`));
  object(3, () => push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`));
  object(4, () => push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`));
  object(5, () => push(`<< /Producer (Fundur)${title ? ` /Title (${pdfText(title)})` : ""} >>`));
  for (const { p, ids } of layout) {
    const stream = ["1 J 1 j", ...p.ops].join("\n");
    const xobjects = p.images.map((im, i) => `/${im.name} ${ids.images[i]} 0 R`).join(" ");
    object(ids.page, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(p.width)} ${f(p.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ""} >> /Contents ${ids.content} 0 R >>`,
      ),
    );
    object(ids.content, () => push(`<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream`));
    p.images.forEach((im, i) =>
      object(ids.images[i], () => {
        push(`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.jpeg.length} >>\nstream\n`);
        push(im.jpeg);
        push("\nendstream");
      }),
    );
  }
  const xref = length;
  let table = `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let i = 1; i < next; i++) table += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${next} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
