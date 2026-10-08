"use client";
import { useCallback, useEffect, useState } from "react";
import { SettingsTabs } from "@/components/views/SettingsTabs";
import { useStudio } from "@/components/providers/StudioProvider";
import { designRequest } from "@/lib/design/client";
import { BuilderAdminControls, type AdminState } from "./WorkflowBuilder";
import type { BuilderSettings } from "@/lib/workflow/builder-model";
import "./workflow.css";
export function WorkflowBuilderAdmin() {
  const { viewer } = useStudio();
  const [admin, setAdmin] = useState<AdminState | null>(null),
    [config, setConfig] = useState<BuilderSettings | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const load = useCallback(async () => {
    const a = await designRequest<AdminState & { settings: BuilderSettings }>(
      "/api/admin/workflow-builder",
    );
    setAdmin(a);
    setConfig(a.settings);
  }, []);
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => setError((e as Error).message));
  }, [load]);
  async function save() {
    if (!config) return;
    setBusy(true);
    setError("");
    try {
      await designRequest("/api/admin/workflow-builder", {
        method: "PUT",
        body: JSON.stringify({
          action: "settings",
          enabled: config.enabled,
          audience: config.audience,
          monthlyCapZar: config.monthlyCapZar,
        }),
      });
      await load();
      setStatus("Pilot settings saved for the selected practice.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page workflow-page">
      <p className="eyebrow">Admin settings</p>
      <h1 className="display-m">Workflow builder pilot</h1>
      <SettingsTabs />
      <p className="muted">
        Enable the builder and its monthly budget for{" "}
        {viewer.workspace || "the selected practice"}. Switch practices to
        review another pilot. Capability requests and first-publication edit
        summaries below cover all practices.
      </p>
      {error && (
        <p role="alert" className="workflow-error">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {config && (
        <>
          <p>
            R{config.spentZar.toFixed(2)} used this month of R
            {config.monthlyCapZar.toFixed(2)}. The cap stops new attempts;
            reported provider charges can exceed estimates.
          </p>
          <BuilderAdminControls
            admin={admin}
            config={config}
            setConfig={setConfig}
            busy={busy}
            saveSettings={save}
            load={load}
            setBusy={setBusy}
            setError={setError}
          />
        </>
      )}
    </main>
  );
}
