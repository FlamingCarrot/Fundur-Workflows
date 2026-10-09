"use client";
import { useStudio } from "@/components/providers/StudioProvider";
import { workflowAvailability } from "@/lib/workflow/availability";
import type { WorkflowDefinition } from "@/lib/workflow/schema";

export function WorkflowAvailability({ workflow }: { workflow: WorkflowDefinition }) {
  const { viewer } = useStudio();
  const availability = workflowAvailability(workflow, viewer);
  return (
    <details className="card" style={{ padding: "0.85rem 1rem", marginTop: "1rem" }}>
      <summary className="small strong" style={{ cursor: "pointer", minHeight: 44, display: "list-item", paddingTop: 10 }}>
        {availability.unavailable.length ? `${availability.unavailable.length} tools need additional access` : "Tools available to your account"} · {availability.aiActions} AI action{availability.aiActions === 1 ? "" : "s"}
      </summary>
      <p className="small muted" style={{ margin: "0.75rem 0" }}>
        {availability.aiEnabled ? "AI requests open as editable drafts. A configured model is needed to run them, and you approve proposed changes." : "You can use the workflow manually. Ask your workspace owner about AI access."}
      </p>
      <ul style={{ paddingLeft: "1.25rem", display: "grid", gap: "0.6rem" }}>
        {availability.modules.map(module => <li key={module.ref} className="small"><strong>{module.name}</strong> · {module.reason ?? "Access enabled"}</li>)}
      </ul>
      {availability.unavailable.length > 0 && <p className="small muted" style={{ marginTop: "0.75rem" }}>Unavailable tools stay hidden in your project. The workflow keeps its original phases and essentials; confirm with your owner that you can complete the required work before starting.</p>}
    </details>
  );
}
