import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

/**
 * Plain text out of the notes people upload: text, Markdown, Word (.docx) and
 * PDF. Old binary Word files (.doc) are not readable here; people are asked to
 * save them as .docx or PDF instead.
 */

export class UnreadableFileError extends Error {}

export const READABLE_EXTENSIONS = [".txt", ".md", ".docx", ".pdf"];

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

export async function extractText(name: string, bytes: Uint8Array): Promise<string> {
  switch (extension(name)) {
    case ".txt":
    case ".md":
      return new TextDecoder("utf-8").decode(bytes);
    case ".docx": {
      try {
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        return value;
      } catch {
        throw new UnreadableFileError(`${name} could not be read as a Word document`);
      }
    }
    case ".pdf": {
      try {
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        const { text } = await extractPdfText(pdf, { mergePages: true });
        if (!text.trim()) throw new UnreadableFileError(`${name} has no text in it (it may be a scan)`);
        return text;
      } catch (err) {
        if (err instanceof UnreadableFileError) throw err;
        throw new UnreadableFileError(`${name} could not be read as a PDF`);
      }
    }
    case ".doc":
      throw new UnreadableFileError(`${name} is an old Word file. Save it as .docx or PDF and add it again.`);
    default:
      throw new UnreadableFileError(`${name} is not a text, Word or PDF file`);
  }
}
