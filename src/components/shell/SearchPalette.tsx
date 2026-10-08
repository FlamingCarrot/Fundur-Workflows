"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  X,
  FolderOpen,
  User,
  CheckSquare,
  FileText,
  PenLine,
} from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import {
  flatten,
  KIND_LABEL,
  search,
  type ResultKind,
  type SearchResult,
} from "@/lib/studio/search";

const ICONS: Record<ResultKind, React.ComponentType<{ size?: number }>> = {
  project: FolderOpen,
  client: User,
  task: CheckSquare,
  document: FileText,
  brief: PenLine,
  form: PenLine,
};

/**
 * One search box across projects, clients, documents, tasks and the brief
 * (P2-08). It opens on ⌘K or from the sidebar, and the arrow keys and Enter
 * move through the results without reaching for the mouse.
 */
export function SearchPalette() {
  const { viewer } = useStudio();
  return <ScopedSearchPalette key={`${viewer.userId}.${viewer.workspaceId}`} />;
}
function ScopedSearchPalette() {
  const { projects, setSearchOpen, persistence, viewer } = useStudio();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState<{
    query: string;
    groups: { kind: ResultKind; results: SearchResult[] }[];
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (persistence !== "server" || query.trim().length < 2) return;
    const controller = new AbortController(),
      timer = setTimeout(() => {
        void fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          cache: "no-store",
          signal: controller.signal,
        })
          .then(async (res) => {
            if (!res.ok) throw new Error("Search unavailable");
            return res.json();
          })
          .then(
            (data) => {
              if (!controller.signal.aborted)
                setSaved({ query, groups: data.groups });
            },
            () => {
              if (!controller.signal.aborted)
                setSaved({
                  query,
                  groups: [],
                  error:
                    "Saved-work search is unavailable. Showing results from loaded projects.",
                });
            },
          );
      }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, persistence, viewer.workspaceId, viewer.userId]);

  const local = useMemo(() => search(projects, query), [projects, query]);
  const groups =
    persistence === "server" && saved?.query === query && !saved.error
      ? saved.groups
      : local;
  const results = useMemo(() => flatten(groups), [groups]);
  const current = results[Math.max(0, Math.min(cursor, results.length - 1))];

  // It is mounted only while open, so it always opens empty, on the search box.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const go = (href: string) => {
    setSearchOpen(false);
    router.push(href);
  };

  return (
    <>
      <div className="scrim" onClick={() => setSearchOpen(false)} />
      <div
        className="sheet sheet-scroll search-sheet"
        role="dialog"
        aria-label="Search"
        onKeyDown={(e) => {
          if (e.key === "Escape") setSearchOpen(false);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => Math.max(0, Math.min(c + 1, results.length - 1)));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          }
          if (e.key === "Enter" && current) {
            e.preventDefault();
            go(current.href);
          }
        }}
      >
        <div className="row" style={{ gap: "0.75rem", marginBottom: "1rem" }}>
          <Search size={18} />
          <input
            ref={inputRef}
            className="input"
            style={{ border: "none", padding: "0.4rem 0", boxShadow: "none" }}
            placeholder="Search projects, clients, documents, tasks"
            aria-label="Search saved work"
            maxLength={120}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label="Close search"
            onClick={() => setSearchOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        {persistence === "server" &&
          query.trim().length >= 2 &&
          (saved?.query !== query ? (
            <p className="small muted" role="status">
              Searching saved work…
            </p>
          ) : saved.error ? (
            <p className="small muted" role="status">
              {saved.error}
            </p>
          ) : null)}

        {query.trim().length < 2 ? (
          <p className="small muted">
            Type at least two letters. A client&apos;s name brings back their
            projects and files.
          </p>
        ) : groups.length === 0 ? (
          persistence === "server" && saved?.query !== query ? null : (
            <p className="small muted">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </p>
          )
        ) : (
          groups.map((group) => (
            <section key={group.kind} style={{ marginBottom: "1.1rem" }}>
              <span className="eyebrow">{KIND_LABEL[group.kind]}</span>
              <div
                className="stack"
                style={{ gap: "0.25rem", marginTop: "0.5rem" }}
              >
                {group.results.map((result) => {
                  const Icon = ICONS[result.kind];
                  return (
                    <button
                      key={result.id}
                      type="button"
                      className="search-result"
                      aria-current={
                        current?.id === result.id ? "true" : undefined
                      }
                      onMouseEnter={() =>
                        setCursor(results.findIndex((r) => r.id === result.id))
                      }
                      onClick={() => go(result.href)}
                    >
                      <span className="fact-icon">
                        <Icon size={15} />
                      </span>
                      <span
                        className="stack"
                        style={{ minWidth: 0, gap: "0.15rem" }}
                      >
                        <span className="small strong truncate">
                          {result.title}
                        </span>
                        <span className="tiny muted truncate">
                          {result.context}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  );
}
