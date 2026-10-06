"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, UploadCloud } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import { MissingProject } from "./MissingProject";
import { fileSize, relativeTime } from "@/lib/studio/format";
import { getWorkflow } from "@/lib/workflow";
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

function Documents({ project }: { project: Project }) {
  const { addDocuments, toggleClientVisible, toast } = useStudio();
  const [over, setOver] = useState(false);
  const phases = getWorkflow(project).phases;
  const currentPhase = phases.find((p) => p.key === project.currentPhase);
  const groups = phases
    .map((ph) => ({ phase: ph, docs: project.documents.filter((d) => d.phaseKey === ph.key) }))
    .filter((g) => g.docs.length > 0);
  const shared = project.documents.filter((d) => d.clientVisible).length;

  // Records the files against the current phase. Storage upload lands with the object store.
  const accept = (files: FileList | null) => {
    if (!files?.length) return;
    const docs: ProjectDocument[] = Array.from(files).map((f, i) => ({
      id: `doc-${Date.now()}-${i}`,
      name: f.name,
      sizeBytes: f.size,
      phaseKey: project.currentPhase,
      uploadedAt: new Date().toISOString(),
      clientVisible: false,
    }));
    addDocuments(project.id, docs);
    toast(`${docs.length} file${docs.length > 1 ? "s" : ""} added to ${currentPhase?.name}`);
  };

  return (
    <div style={swatchVar(project.swatch)}>
      <Link href={`/projects/${project.id}`} className="back-link rise" style={{ marginBottom: "2rem" }}>
        <ArrowLeft size={15} /> {project.name}
      </Link>
      <header className="rise" style={{ ["--i" as string]: 1, marginBottom: "2rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>
          {project.documents.length} files · {shared} shared with client
        </p>
        <h1 className="display-l">Documents</h1>
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
          They&apos;ll be filed under {currentPhase?.name}. Plans, notes, photos and PDFs up to 50 MB.
        </span>
      </label>

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
                      <span className="small strong truncate">{doc.name}</span>
                      <span className="tiny muted">{fileSize(doc.sizeBytes)}</span>
                    </span>
                    <span className="tiny muted file-date">{relativeTime(doc.uploadedAt)}</span>
                    <label className="row tiny" style={{ gap: "0.5rem", cursor: "pointer" }}>
                      <span className={doc.clientVisible ? "strong" : "muted"} style={{ color: doc.clientVisible ? "var(--good)" : undefined }}>
                        {doc.clientVisible ? "Client can see" : "Private"}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={doc.clientVisible}
                        aria-label={`Share ${doc.name} with client`}
                        className="switch"
                        onClick={() => toggleClientVisible(project.id, doc.id)}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
