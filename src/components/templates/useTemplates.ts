"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { templateLibrary } from "@/lib/templates/client";
import { templateSummary, type TemplateSummary } from "@/lib/templates/model";
export function useTemplates() {
  const { viewer, persistence } = useStudio(),
    allowed =
      viewer.features?.design !== false &&
      (persistence !== "server" ||
        viewer.workspaceRole === "owner" ||
        viewer.workspaceRole === "member"),
    service = useMemo(
      () =>
        templateLibrary(
          persistence === "server",
          `${viewer.userId ?? "demo"}.${viewer.workspaceId ?? "demo"}`,
        ),
      [persistence, viewer.userId, viewer.workspaceId],
    );
  const [templates, setTemplates] = useState<TemplateSummary[]>([]),
    [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setTemplates(await service.list());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [service]);
  useEffect(() => {
    let active = true;
    if (allowed)
      service.list().then(
        (rows) => {
          if (active) setTemplates(rows);
        },
        (e) => {
          if (active) setError(e.message);
        },
      );
    return () => {
      active = false;
    };
  }, [allowed, service]);
  return {
    allowed,
    templates,
    error,
    reload,
    save: async (input: Parameters<typeof service.save>[0]) => {
      const saved = await service.save(input);
      setTemplates((rows) => [templateSummary(saved), ...rows]);
      return saved;
    },
    remove: async (id: string) => {
      await service.remove(id);
      setTemplates((rows) => rows.filter((t) => t.id !== id));
    },
  };
}
