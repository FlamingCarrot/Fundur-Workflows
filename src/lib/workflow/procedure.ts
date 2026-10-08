import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { BuilderError } from "./builder-store";
export const PROCEDURE_BYTES = 3 * 1024 * 1024;
/** Reject expansive Word ZIPs before asking the document reader to decompress them. */
function checkWordArchive(bytes: Uint8Array) {
  const b = Buffer.from(bytes),
    floor = Math.max(0, b.length - 65557);
  let end = -1;
  for (let p = b.length - 22; p >= floor; p--)
    if (b.readUInt32LE(p) === 0x06054b50) {
      end = p;
      break;
    }
  if (end < 0) throw new BuilderError("This Word archive could not be read.");
  const count = b.readUInt16LE(end + 10),
    offset = b.readUInt32LE(end + 16);
  if (count > 500 || offset >= b.length)
    throw new BuilderError("This Word archive is too large or complex.");
  let p = offset,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50)
      throw new BuilderError("This Word archive could not be read.");
    total += b.readUInt32LE(p + 24);
    if (total > 20 * 1024 * 1024)
      throw new BuilderError("This Word document expands beyond 20 MB.");
    p +=
      46 +
      b.readUInt16LE(p + 28) +
      b.readUInt16LE(p + 30) +
      b.readUInt16LE(p + 32);
  }
}
export async function readProcedure(name: string, bytes: Uint8Array) {
  if (bytes.length > PROCEDURE_BYTES)
    throw new BuilderError("Choose a procedure file up to 3 MB.");
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  let text: string;
  try {
    if (ext === ".txt" || ext === ".md")
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    else if (ext === ".docx") {
      checkWordArchive(bytes);
      text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) }))
        .value;
    } else if (ext === ".pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      try {
        if (pdf.numPages > 100)
          throw new BuilderError("Keep procedure PDFs to 100 pages.");
        text = (await extractText(pdf, { mergePages: true })).text;
      } finally {
        await pdf.loadingTask.destroy();
      }
    } else
      throw new BuilderError(
        "Choose a TXT, Markdown, DOCX or text-based PDF file.",
      );
  } catch (e) {
    if (e instanceof BuilderError) throw e;
    throw new BuilderError(
      "This procedure could not be read. Try saving it as plain text.",
    );
  }
  text = text.replace(/\u0000/g, "").trim();
  if (!text)
    throw new BuilderError(
      "This file has no readable text. A scanned PDF needs text recognition first.",
    );
  if (text.length > 30000)
    throw new BuilderError(
      "The procedure is longer than 30,000 characters. Upload the relevant section or paste an excerpt.",
    );
  return text;
}
