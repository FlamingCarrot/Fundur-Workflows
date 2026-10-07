"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, Download, History, RotateCcw, UploadCloud, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { IssueMarker } from "@/components/ui/IssueMarker";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import { ShareManager } from "@/components/sharing/ShareManager";
import { MissingProject } from "./MissingProject";
import { fileSize, relativeTime } from "@/lib/studio/format";
import { getWorkflow } from "@/lib/workflow";
import { downloadHref, MAX_UPLOAD_BYTES, uploadToProject } from "@/lib/studio/uploads";
import type { Project, ProjectDocument } from "@/lib/studio/types";

export function DocumentsView({ projectId }: { projectId: string }) {
  const { ready, getProject } = useStudio();
  const project = getProject(projectId);
  return (
    <main className="page">
      <WhenReady ready={ready}>{project ? <Documents project={project} /> : <MissingProject />}</WhenReady>
    </main>
  );
}

interface Uploading {
  key: string;
  name: string;
  progress: number;
  error?: string;
}

function Documents({ project }: { project: Project }) {
  const { addDocuments, toggleClientVisible, toast, fileStorage, persistence, viewer } = useStudio();
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const [historyFor, setHistoryFor] = useState<ProjectDocument | null>(null);
  const phases = getWorkflow(project).phases;
  const currentPhase = phases.find((p) => p.key === project.currentPhase);
  const groups = phases
    .map((ph) => ({ phase: ph, docs: project.documents.filter((d) => d.phaseKey === ph.key) }))
    .filter((g) => g.docs.length > 0);
  const shared = project.documents.filter((d) => d.clientVisible).length;

  const newDocument = (f: File, storageKey?: string): ProjectDocument => ({
    id: crypto.randomUUID(),
    name: f.name,
    sizeBytes: f.size,
    phaseKey: project.currentPhase,
    uploadedAt: new Date().toISOString(),
    clientVisible: false,
    ...(storageKey ? { storageKey, stored: true, version: 1 } : {}),
  });

  // Files go to storage first and are added to the project once they are safely there.
  // Without storage only their names are recorded, as on the demo.
  const accept = (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    if (!fileStorage) {
      addDocuments(project.id, list.map((f) => newDocument(f)));
      toast(`${list.length} file${list.length > 1 ? "s" : ""} added to ${currentPhase?.name}`);
      return;
    }
    for (const f of list) {
      const key = `${f.name}-${f.size}-${Math.random()}`;
      if (f.size > MAX_UPLOAD_BYTES) {
        setUploading((u) => [...u, { key, name: f.name, progress: 0, error: "Over the 200 MB limit" }]);
        continue;
      }
      setUploading((u) => [...u, { key, name: f.name, progress: 0 }]);
      uploadToProject(project.id, f, (progress) =>
        setUploading((u) => u.map((x) => (x.key === key ? { ...x, progress } : x)))
      ).then(
        (storageKey) => {
          addDocuments(project.id, [newDocument(f, storageKey)]);
          setUploading((u) => u.filter((x) => x.key !== key));
          toast(`${f.name} uploaded to ${currentPhase?.name}`);
        },
        (err: Error) =>
          setUploading((u) => u.map((x) => (x.key === key ? { ...x, error: err.message || "Upload failed" } : x)))
      );
    }
  };

  return (
    <div style={swatchVar(project.swatch)}>
      <Link href={`/projects/${project.id}`} className="back-link rise" style={{ marginBottom: "2rem" }}>
        <ArrowLeft size={15} /> {project.name}
      </Link>
      <header className="rise" style={{ ["--i" as string]: 1, marginBottom: "2rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>
          {project.documents.length} files · {shared} eligible for client links
        </p>
        <h1 className="display-l row" style={{ gap: "0.75rem" }}>
          Documents
          <IssueMarker moduleKey="documents" projectId={project.id} />
        </h1>
      </header>

      <label
        className="dropzone rise"
        data-over={over}
        style={{ ["--i" as string]: 2, marginBottom: "2.5rem" }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          accept(e.dataTransfer.files);
        }}
      >
        <input type="file" multiple onChange={(e) => accept(e.target.files)} aria-label="Upload files" />
        <span className="dropzone-icon">
          <UploadCloud size={24} />
        </span>
        <span style={{ fontWeight: 600 }}>Drop files here, or browse</span>
        <span className="small muted">
          They&apos;ll be filed under {currentPhase?.name}. Plans, drawings, notes, photos and PDFs up to 200 MB each.
        </span>
      </label>

      <label className="btn btn-primary btn-lg show-sm capture rise" style={{ ["--i" as string]: 2 }}>
        <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => accept(e.target.files)} />
        <Camera size={18} /> Take a photo
      </label>

      {persistence === "server" && !fileStorage && (
        <p className="small muted rise" style={{ margin: "-1.5rem 0 2rem", textAlign: "center" }}>
          File storage isn&apos;t connected yet, so only file names are kept.
          {viewer.isAdmin && " Connect a Blob store to this project in Vercel to keep the files themselves."}
        </p>
      )}

      {uploading.length > 0 && (
        <div className="card" style={{ marginBottom: "2rem" }} aria-live="polite">
          {uploading.map((u) => (
            <div key={u.key} className="file-row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
              <span className="stack" style={{ minWidth: 0, gap: "0.4rem" }}>
                <span className="small strong truncate">{u.name}</span>
                {u.error ? (
                  <span className="tiny" style={{ color: "var(--bad)" }}>{u.error}</span>
                ) : (
                  <span className="focus-progress" style={{ margin: 0 }} role="progressbar" aria-valuenow={Math.round(u.progress * 100)} aria-label={`Uploading ${u.name}`}>
                    <span style={{ width: `${Math.max(3, Math.round(u.progress * 100))}%` }} />
                  </span>
                )}
              </span>
              {u.error ? (
                <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setUploading((all) => all.filter((x) => x.key !== u.key))}>
                  <X size={16} />
                </button>
              ) : (
                <span className="tiny muted tabular">{Math.round(u.progress * 100)}%</span>
              )}
            </div>
          ))}
        </div>
      )}

      {groups.length === 0 && (
        <p className="muted" style={{ textAlign: "center" }}>No documents yet. Your first upload will appear here.</p>
      )}

      <div className="stack" style={{ gap: "2.25rem" }}>
        {groups.map(({ phase, docs }, gi) => (
          <section key={phase.key} className="rise" style={{ ["--i" as string]: gi + 3 }}>
            <div className="section-title">
              <h2>
                {phase.name}
                <span className="count">{docs.length}</span>
              </h2>
            </div>
            <div className="card">
              {docs.map((doc) => {
                const ext = doc.name.split(".").pop()?.slice(0, 4) ?? "file";
                return (
                  <div key={doc.id} className="file-row">
                    <span className="file-icon">{ext}</span>
                    <span className="stack" style={{ minWidth: 0 }}>
                      {doc.stored ? (
                        <a href={downloadHref(project.id, doc.id)} className="small strong truncate row" style={{ gap: "0.35rem" }} title={`Download ${doc.name}`}>
                          {doc.name} <Download size={13} style={{ flexShrink: 0, color: "var(--ink-3)" }} />
                        </a>
                      ) : (
                        <span className="small strong truncate">{doc.name}</span>
                      )}
                      <span className="tiny muted">
                        {fileSize(doc.sizeBytes)}
                        {doc.stored && (doc.version ?? 1) > 1 ? ` · version ${doc.version}` : ""}
                        {doc.kind ? ` · ${doc.kind}` : ""}
                      </span>
                    </span>
                    <span className="tiny muted file-date row" style={{ gap: "0.35rem" }}>
                      {relativeTime(doc.uploadedAt)}
                      {doc.stored && (
                        <button type="button" className="icon-btn" aria-label={`Versions of ${doc.name}`} title="Versions" onClick={() => setHistoryFor(doc)}>
                          <History size={15} />
                        </button>
                      )}
                    </span>
                    {viewer.features?.sharing !== false && viewer.workspaceRole !== "collaborator" && <label className="row tiny" style={{ gap: "0.5rem", cursor: "pointer" }}>
                      <span className={doc.clientVisible ? "strong" : "muted"} style={{ color: doc.clientVisible ? "var(--good)" : undefined }}>
                        {doc.clientVisible ? "Client-visible" : "Private"}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={doc.clientVisible}
                        aria-label={`Make ${doc.name} client-visible`}
                        className="switch"
                        onClick={() => toggleClientVisible(project.id, doc.id)}
                      />
                    </label>}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {persistence === "server" && viewer.features?.sharing !== false && viewer.workspaceRole !== "collaborator" && <ShareManager projectId={project.id} documentState={project.documents.map(d=>`${d.id}:${d.clientVisible}:${d.version??1}`).join(",")} />}
      {historyFor && <VersionsSheet project={project} doc={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

interface DocVersion {
  documentId: string;
  version: number;
  name: string;
  sizeBytes: number;
  trigger: string;
  notes: string | null;
  createdAt: string;
}

/** A stored file's versions: download any, restore an older one, or upload a new one. */
function VersionsSheet({ project, doc: initial, onClose }: { project: Project; doc: ProjectDocument; onClose: () => void }) {
  const { replaceDocumentFile, restoreDocumentVersion, toast, getProject } = useStudio();
  const doc = getProject(project.id)?.documents.find((d) => d.id === initial.id) ?? initial;
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch(`/api/projects/${encodeURIComponent(project.id)}/versions`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Couldn't load the versions"))))
        .then(
          (body: { documentVersions: DocVersion[] }) => setVersions(body.documentVersions.filter((v) => v.documentId === initial.id)),
          (err: Error) => setError(err.message)
        ),
    [project.id, initial.id]
  );
  useEffect(() => {
    void load();
  }, [load, doc.version]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const restore = async (v: DocVersion) => {
    setBusy(`restore-${v.version}`);
    if (await restoreDocumentVersion(project.id, doc.id, v.version)) toast(`Version ${v.version} restored`);
    setBusy(null);
  };

  const replace = async (file: File | undefined) => {
    if (!file) return;
    setBusy("upload");
    setError(null);
    try {
      const storageKey = await uploadToProject(project.id, file);
      if (await replaceDocumentFile(project.id, doc.id, { storageKey, name: file.name, sizeBytes: file.size })) {
        toast(`New version of ${doc.name} saved`);
      }
    } catch (err) {
      setError((err as Error).message || "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const label = (v: DocVersion) =>
    v.trigger === "restore" ? (v.notes ?? "Restored") : v.version === 1 ? "First upload" : "Uploaded";

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={`Versions of ${doc.name}`} style={{ maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}>
        <div className="row-between" style={{ marginBottom: "1rem", gap: "1rem" }}>
          <h2 className="display-s truncate">{doc.name}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="small muted" style={{ marginBottom: "1.25rem" }}>
          Every upload is kept. Restoring an older version makes it current again and keeps the others.
        </p>
        {error && <p className="small" role="alert" style={{ color: "var(--bad)", marginBottom: "1rem" }}>{error}</p>}
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          {!versions && !error && <p className="small muted" style={{ padding: "1rem" }}>Loading…</p>}
          {versions?.map((v) => {
            const current = v.version === (doc.version ?? 1);
            return (
              <div key={v.version} className="file-row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                <span className="stack" style={{ minWidth: 0 }}>
                  <span className="small strong">
                    Version {v.version}
                    {current && <span className="tag tag-good" style={{ marginLeft: "0.5rem" }}>Current</span>}
                  </span>
                  <span className="tiny muted truncate">
                    {label(v)} {relativeTime(v.createdAt)} · {fileSize(v.sizeBytes)}
                    {v.name && v.name !== doc.name ? ` · ${v.name}` : ""}
                  </span>
                </span>
                <span className="row" style={{ gap: "0.25rem" }}>
                  <a href={downloadHref(project.id, doc.id, v.version)} className="icon-btn" aria-label={`Download version ${v.version}`} title="Download">
                    <Download size={15} />
                  </a>
                  {!current && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={!!busy}
                      onClick={() => void restore(v)}
                    >
                      <RotateCcw size={14} /> {busy === `restore-${v.version}` ? "Restoring…" : "Restore"}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <label className="btn btn-primary" style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          <UploadCloud size={16} /> {busy === "upload" ? "Uploading…" : "Upload a new version"}
          <input
            type="file"
            hidden
            disabled={!!busy}
            onChange={(e) => {
              void replace(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </>
  );
}