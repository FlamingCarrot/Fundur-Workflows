/**
 * A PDF of images, one per page, with a caption under each: renders and views
 * to send a client. Written by hand (JPEG pages need nothing more than the
 * image and a font that every reader has), so it works in the browser with no
 * library and in tests.
 */

export interface PdfPage {
  /** JPEG bytes. */
  jpeg: Uint8Array;
  width: number;
  height: number;
  caption?: string;
}

const enc = new TextEncoder();

/** PDF strings in WinAnsi: keep printable ASCII, swap the rest. */
function pdfText(s: string): string {
  const plain = s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/×/g, "x")
    .replace(/[^\x20-\x7e]/g, "");
  return plain.replace(/[\\()]/g, (c) => `\\${c}`);
}

export function imagesToPdf(pages: PdfPage[], options: { title?: string; landscape?: boolean } = {}): Uint8Array {
  if (!pages.length) throw new Error("Choose at least one image.");
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
  // A4 landscape in points, the image fitted inside a margin with room for the caption.
  const pageW = options.landscape === false ? 595.28 : 841.89;
  const pageH = options.landscape === false ? 841.89 : 595.28;
  const margin = 28;
  const captionSpace = 26;
  const font = 3;
  const kids: number[] = [];
  let next = 4;
  const layout = pages.map((p) => {
    const ids = { page: next, image: next + 1, content: next + 2 };
    next += 3;
    kids.push(ids.page);
    return { p, ids };
  });
  object(1, () => push(`<< /Type /Catalog /Pages 2 0 R >>`));
  object(2, () => push(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`));
  object(font, () => push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`));
  for (const { p, ids } of layout) {
    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2 - captionSpace;
    const k = Math.min(availW / p.width, availH / p.height);
    const w = p.width * k;
    const h = p.height * k;
    const x = (pageW - w) / 2;
    const y = margin + captionSpace + (availH - h) / 2;
    const caption = [options.title, p.caption].filter(Boolean).join(" - ");
    const stream = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q` + (caption ? `\nBT /F1 10 Tf 0.25 0.25 0.23 rg ${margin} ${margin + 8} Td (${pdfText(caption).slice(0, 180)}) Tj ET` : "");
    object(ids.page, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 ${ids.image} 0 R >> /Font << /F1 ${font} 0 R >> >> /Contents ${ids.content} 0 R >>`));
    object(ids.image, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push("\nendstream");
    });
    object(ids.content, () => push(`<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream`));
  }
  const xref = length;
  const count = next;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) table += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** The bytes of a data URL. */
export function dataUrlBytes(url: string): Uint8Array {
  const base64 = url.slice(url.indexOf(",") + 1);
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
