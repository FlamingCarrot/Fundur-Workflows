/**
 * The Markdown the assistant writes documents in, as HTML: headings,
 * paragraphs, lists, tables, quotes, bold, italics, code and links. Every bit
 * of text is escaped and links must be http(s) or mailto, so the result is
 * safe to put in the page. Used for the canvas preview, printing to PDF, Word
 * downloads and files saved to the project. Safe to import in the browser.
 */

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text: string): string {
  let out = escape(text);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_m, label: string, href: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  return out;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isRule = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (isTableRow(line)) {
      const rows: string[] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(lines[i++]);
      const head = rows.length > 1 && isRule(rows[1]) ? cells(rows[0]) : null;
      const body = (head ? rows.slice(2) : rows).filter((r) => !isRule(r));
      out.push(
        `<table>${head ? `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` : ""}<tbody>${body
          .map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${quote.map(inline).join("<br>")}</blockquote>`);
      continue;
    }
    const item = /^\s*([-*•]|\d+[.)])\s+/;
    if (item.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && item.test(lines[i])) {
        const checked = /^\s*[-*]\s+\[([ xX])\]\s+/.exec(lines[i]);
        const text = lines[i].replace(item, "").replace(/^\[[ xX]\]\s+/, "");
        items.push(`<li>${checked ? (checked[1].trim() ? "☑ " : "☐ ") : ""}${inline(text)}</li>`);
        i++;
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*>)/.test(lines[i]) && !item.test(lines[i]) && !isTableRow(lines[i])) para.push(lines[i++]);
    out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return out.join("\n");
}

/** A whole HTML page for a document: printing to PDF, Word downloads and project files. */
export function documentPage(title: string, md: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>
body { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 20pt; margin: 0 0 0.6em; } h2 { font-size: 15pt; margin: 1.2em 0 0.4em; } h3, h4 { font-size: 12pt; margin: 1em 0 0.3em; }
table { border-collapse: collapse; width: 100%; margin: 0.6em 0; } th, td { border: 1px solid #bbb; padding: 4px 8px; text-align: left; vertical-align: top; } th { background: #f1f1f1; }
blockquote { border-left: 3px solid #ccc; margin: 0.6em 0; padding-left: 0.8em; color: #444; }
code { font-family: Consolas, monospace; font-size: 10pt; } pre { background: #f5f5f5; padding: 0.6em; white-space: pre-wrap; }
a { color: #1a4fa0; }
@media print { body { margin: 0; max-width: none; } }
</style></head>
<body>${markdownToHtml(md)}</body></html>`;
}
