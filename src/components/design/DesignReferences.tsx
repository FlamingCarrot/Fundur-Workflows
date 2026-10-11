"use client";
import { useEffect, useState } from "react";
import { DesignLink } from "./DesignLink";
import { useStudio } from "@/components/providers/StudioProvider";
import { localPlans, serverPlans } from "@/lib/plan/client";
import { getWorkflow, label } from "@/lib/workflow";
import { publicPlan } from "@/lib/design/public-plan";
import type { Plan } from "@/lib/plan/geometry";
import type { Project } from "@/lib/studio/types";
import type { DesignData } from "@/lib/design/schema";
import { SharedPlan } from "@/components/sharing/SharedPlan";
import { BoardPreview } from "./BoardPreview";
import { downloadHref } from "@/lib/studio/uploads";
export function DesignReferences({
  project,
  data,
  flush,
}: {
  project: Project;
  data: DesignData;
  flush: () => Promise<boolean>;
}) {
  const { persistence, viewer } = useStudio();
  const [plan, setPlan] = useState<Plan | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (viewer.features?.floor_plan === false) return;
    let active = true;
    const backend =
      persistence === "server" ? serverPlans : localPlans(viewer.name);
    backend.load(project.id).then(
      (s) => {
        if (active)
          setPlan(
            s.plan && s.plan.layouts.some((l) => l.chosen)
              ? publicPlan(s.plan)
              : null,
          );
      },
      (e) => {
        if (active) setError(e.message);
      },
    );
    return () => {
      active = false;
    };
  }, [project.id, persistence, viewer.name, viewer.features?.floor_plan]);
  const phase = getWorkflow(project).phases.find((p) =>
    p.modules.some((m) => m === "item_register:palette"),
  );
  const boardKey = phase?.modules
    .find((m) => m.startsWith("canvas_board:"))
    ?.split(":")[1];
  const board = data.boards.find((b) => b.key === boardKey);
  return (
    <div className="design-references">
      {viewer.features?.floor_plan !== false && (
        <section className="card">
          <h2>Chosen {label(project, "floor_plan", "plan").toLowerCase()}</h2>
          {plan ? (
            <SharedPlan plan={plan} />
          ) : (
            <p className="small muted">
              {error ||
                "Choose a layout to keep the approved direction in view here."}
            </p>
          )}
        </section>
      )}
      {boardKey && (
        <section className="card">
          <div className="row-between">
            <h2>{label(project, boardKey, "Concept board")}</h2>
            <DesignLink
              flush={flush}
              className="small"
              href={`/projects/${project.id}/boards/${boardKey}`}
            >
              Open board
            </DesignLink>
          </div>
          {board?.cards.length ? (
            <BoardPreview
              board={board}
              imageUrl={(id) => downloadHref(project.id, id)}
            />
          ) : (
            <p className="small muted">
              Gather your concept direction on the board.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
