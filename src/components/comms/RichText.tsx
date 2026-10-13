"use client";
import { useMemo, type ReactNode } from "react";

/**
 * A post's text, lightly formatted the way Slack and Teams read it:
 * **bold**, *italic* or _italic_, ~~struck~~, `code`, ```code blocks```,
 * "- " and "1. " lists and "> " quotes, with links and @mentions picked out.
 * It never renders HTML from the text: everything stays plain text in React.
 */
export function RichText({ text, people }: { text: string; people: { key: string; name: string }[] }) {
  const names = useMemo(() => [...people.map((p) => p.name), "Assistant", "everyone", "channel"].filter(Boolean).sort((a, b) => b.length - a.length), [people]);
  return <>{blocks(text, names)}</>;
}

type Key = { n: number };

function blocks(text: string, names: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  const key: Key = { n: 0 };
  // Code fences first: nothing inside them is formatted.
  const parts = text.split(/```(?:[a-z]+\n)?/);
  parts.forEach((part, i) => {
    if (i % 2 === 1 && i < parts.length - 1) {
      out.push(
        <pre key={`c${key.n++}`} className="cv-code">
          <code>{part.replace(/^\n|\n$/g, "")}</code>
        </pre>,
      );
      return;
    }
    // An unclosed fence is shown as written.
    const chunk = i % 2 === 1 ? "```" + part : part;
    out.push(...lines(chunk, names, key));
  });
  return out;
}

function lines(text: string, names: string[], key: Key): ReactNode[] {
  const out: ReactNode[] = [];
  const rows = text.split("\n");
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const joined = para.join("\n");
    if (joined.trim()) out.push(<p key={`p${key.n++}`}>{inline(joined, names, key)}</p>);
    para = [];
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const bullet = /^\s*[-*•]\s+/.test(row);
    const numbered = /^\s*\d{1,3}[.)]\s+/.test(row);
    const quote = /^\s*>\s?/.test(row);
    if (!bullet && !numbered && !quote) {
      para.push(row);
      continue;
    }
    flush();
    const kind = bullet ? "ul" : numbered ? "ol" : "quote";
    const items: string[] = [];
    const strip = kind === "ul" ? /^\s*[-*•]\s+/ : kind === "ol" ? /^\s*\d{1,3}[.)]\s+/ : /^\s*>\s?/;
    while (i < rows.length && strip.test(rows[i])) items.push(rows[i++].replace(strip, ""));
    i--;
    if (kind === "quote") out.push(<blockquote key={`q${key.n++}`}>{inline(items.join("\n"), names, key)}</blockquote>);
    else {
      const List = kind;
      out.push(
        <List key={`l${key.n++}`}>
          {items.map((it) => (
            <li key={key.n++}>{inline(it, names, key)}</li>
          ))}
        </List>,
      );
    }
  }
  flush();
  return out;
}

const MARKS: { re: RegExp; wrap: (inner: ReactNode, k: number) => ReactNode; raw?: boolean }[] = [
  { re: /`([^`\n]+)`/, wrap: (t, k) => <code key={k}>{t}</code>, raw: true },
  { re: /\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*/, wrap: (t, k) => <strong key={k}>{t}</strong> },
  { re: /~~([^~\n]+)~~/, wrap: (t, k) => <s key={k}>{t}</s> },
  { re: /(?<![\p{L}\p{N}*])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?![\p{L}\p{N}*])/u, wrap: (t, k) => <em key={k}>{t}</em> },
  { re: /(?<![\p{L}\p{N}_])_([^_\s](?:[^_\n]*[^_\s])?)_(?![\p{L}\p{N}_])/u, wrap: (t, k) => <em key={k}>{t}</em> },
];

/** Inline marks, the earliest first; links and mentions in what is left. */
function inline(text: string, names: string[], key: Key): ReactNode[] {
  let best: { i: number; m: RegExpExecArray; mark: (typeof MARKS)[number] } | null = null;
  for (const mark of MARKS) {
    const m = mark.re.exec(text);
    if (m && (!best || m.index < best.i)) best = { i: m.index, m, mark };
  }
  // A link may contain underscores or asterisks; marks never start inside one.
  const link = /https?:\/\/[^\s<>()]+/.exec(text);
  if (best && link && link.index <= best.i && best.i < link.index + link[0].length) best = null;
  if (!best) return linksAndMentions(text, names, key);
  const { m, mark } = best;
  return [
    ...linksAndMentions(text.slice(0, m.index), names, key),
    mark.wrap(mark.raw ? m[1] : inline(m[1], names, key), key.n++),
    ...inline(text.slice(m.index + m[0].length), names, key),
  ];
}

function linksAndMentions(text: string, names: string[], key: Key): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|@/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) {
      parts.push(text.slice(last, m.index));
      parts.push(
        <a key={`a${key.n++}`} href={m[1]} target="_blank" rel="noopener noreferrer nofollow">
          {m[1]}
        </a>,
      );
      last = m.index + m[1].length;
      continue;
    }
    const rest = text.slice(m.index + 1).toLowerCase();
    const name = names.find((n) => rest.startsWith(n.toLowerCase()) && !/[\p{L}\p{N}]/u.test(rest[n.length] ?? ""));
    if (!name || (m.index > 0 && /[\p{L}\p{N}._-]/u.test(text[m.index - 1]))) continue;
    parts.push(text.slice(last, m.index));
    parts.push(
      <span key={`m${key.n++}`} className="cv-mention">
        @{text.slice(m.index + 1, m.index + 1 + name.length)}
      </span>,
    );
    last = m.index + 1 + name.length;
    re.lastIndex = last;
  }
  parts.push(text.slice(last));
  return parts.filter((p) => p !== "");
}
