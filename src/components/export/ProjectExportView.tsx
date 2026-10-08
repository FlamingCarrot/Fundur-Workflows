"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady } from "@/components/ui/primitives";
import { ProjectWorkPage } from "@/components/projects/ProjectWorkPage";
import { MissingProject } from "@/components/views/MissingProject";
import { hasPermission } from "@/lib/auth/permissions";
import { fileSize } from "@/lib/studio/format";
import { localPlans } from "@/lib/plan/client";
import { designBackend } from "@/lib/design/client";
import { getWorkflow } from "@/lib/workflow";
import type { Project } from "@/lib/studio/types";
import type { archiveSummary, ProjectArchive } from "@/lib/export/archive";
import { projectArchiveStream } from "@/lib/export/archive";
import "@/components/design/design.css";
type Summary = ReturnType<typeof archiveSummary>;
export function ProjectExportView({ projectId }: { projectId: string }) {
  const { ready, getProject, viewer } = useStudio(),
    project = getProject(projectId);
  return (
    <WhenReady ready={ready}>
      {project ? (
        <ExportScreen
          key={`${viewer.userId}.${viewer.workspaceId}.${projectId}`}
          project={project}
        />
      ) : (
        <main className="page">
          <MissingProject />
        </main>
      )}
    </WhenReady>
  );
}
function ExportScreen({ project }: { project: Project }) {
  const { persistence, viewer } = useStudio(),
    [summary, setSummary] = useState<Summary | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const allowed =
      persistence !== "server" ||
      hasPermission("project:export", { workspaceRole: viewer.workspaceRole }),
    url = `/api/projects/${encodeURIComponent(project.id)}/export`;
  useEffect(() => {
    let active = true;
    if (persistence === "server" && allowed)
      fetch(url + "?summary=1", { cache: "no-store" })
        .then(
          async (res) => {
            const data = await res.json();
            if (!res.ok)
              throw new Error(
                data.error || "The archive could not be prepared.",
              );
            if (active) {
              setSummary(data);
              setError("");
            }
          },
          (e) => {
            if (active) setError(e.message);
          },
        )
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [persistence, allowed, url, retry]);
  async function downloadDemo() {
    setBusy(true);
    setError("");
    try {
      const design = await designBackend(
        project.id,
        `${viewer.userId ?? "demo"}.${viewer.workspaceId ?? "demo"}`,
        false,
      ).load();
      const planBackend = localPlans(viewer.name),
        planState = await planBackend.load(project.id);
      const planVersions = await Promise.all(
        planState.versions.map((v) => planBackend.getVersion(project.id, v.id)),
      );
      const archive: ProjectArchive = {
        takenAt: new Date().toISOString(),
        projectName: project.name,
        slug: project.id,
        data: {
          project: {
            ...project,
            documents: project.documents.map(({ storageKey, ...d }) => {
              void storageKey;
              return d;
            }),
          },
          workflow: getWorkflow(project),
          floorPlans: planState.plan
            ? [{ geometry: planState.plan, revision: planState.revision }]
            : [],
          planVersions: planVersions.map((v) => ({ ...v, geometry: v.plan })),
          planCorrections: planState.corrections,
          design: [{ data: design.data, revision: design.revision }],
        },
        files: project.documents.map((d) => ({
          documentId: d.id,
          version: d.version ?? 1,
          name: d.name,
          phase: d.phaseKey,
          sizeBytes: d.sizeBytes,
          current: true,
          storageKey: "",
          path: `documents/${d.id}/v${d.version ?? 1}-document`,
        })),
      };
      const blob = await new Response(
          projectArchiveStream(archive, async () => null),
        ).blob(),
        href = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = href;
      link.download = `${project.id}-demo-data.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ProjectWorkPage project={project} title="Export project ZIP"
      description="Keep a private archive of your work, original uploads and document history.">
        {!allowed ? (
          <section className="card" style={{ padding: "1.5rem" }}>
            <p>
              Project archives are available to practice owners and members.
            </p>
            <Link href={`/projects/${project.id}/documents`}>
              Back to documents
            </Link>
          </section>
        ) : (
          <section
            className="card stack"
            style={{
              padding: "clamp(1rem,3vw,2rem)",
              gap: "1rem",
              overflowWrap: "anywhere",
            }}
          >
            <h2>Project ZIP archive</h2>
            <p className="muted">
              Includes saved brief and checklists, tasks, boards, selections,
              quote requests, floor-plan geometry and named versions, phase
              snapshots, conversation records, and the workflow definition.
              Uploaded documents include every stored version.
            </p>
            <p className="small muted">
              This archive contains private project notes and sourcing data.
              Review it before sharing. The ZIP includes a manifest identifying
              missing or unuploaded files. Workspace contacts, provider
              credentials and client access links are excluded.
            </p>
            {error && (
              <div role="alert">
                <p className="design-error">{error}</p>
                <button
                  className="btn btn-secondary"
                  onClick={() => setRetry((n) => n + 1)}
                >
                  Retry preparation
                </button>
              </div>
            )}
            {persistence === "server" ? (
              summary ? (
                <>
                  <p>
                    <strong>
                      {summary.documents} documents · {summary.versions}{" "}
                      versions
                    </strong>
                    <br />
                    <span className="small muted">
                      {fileSize(summary.totalBytes)} recorded ·{" "}
                      {summary.storedVersions} versions uploaded
                    </span>
                  </p>
                  {summary.unuploadedVersions.length > 0 && (
                    <details>
                      <summary>
                        {summary.unuploadedVersions.length} version(s) have no
                        uploaded file
                      </summary>
                      <ul>
                        {summary.unuploadedVersions.map((d) => (
                          <li key={`${d.documentId}.${d.version}`}>
                            {d.name} · version {d.version}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <a
                    className="btn btn-primary"
                    href={url}
                    style={{ minHeight: 44, whiteSpace: "normal" }}
                  >
                    Download project ZIP
                  </a>
                </>
              ) : (
                !error && <p role="status">Preparing archive summary…</p>
              )
            ) : (
              <>
                <p className="small muted">
                  The demo keeps current project data in this browser. Uploaded
                  file bytes, server document history, plan history and
                  conversations are unavailable here and are not included in the
                  demo archive.
                </p>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void downloadDemo()}
                >
                  {busy ? "Preparing demo data…" : "Download demo data ZIP"}
                </button>
              </>
            )}
            <p className="tiny muted">
              Downloads use the latest saved data. Save edits in other windows
              first. Archives stream to your browser; keep this page available
              until your browser completes the download. Maximum 2 GB and 2,000
              document versions. An export is a portable record, not an
              automatic restore package.
            </p>
          </section>
        )}
    </ProjectWorkPage>
  );
}
