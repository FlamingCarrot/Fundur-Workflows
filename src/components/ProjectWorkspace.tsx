"use client";

import React, { useState, useTransition } from "react";
import { Header } from "./Header";
import { PhaseBar, PhaseInfo } from "./PhaseBar";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useRealtimeChannel } from "@/hooks/useRealtimeChannel";
import workflowDefinition from "@/lib/workflow/definitions/interior-design-corporate.json";
import {
  FileText,
  UploadCloud,
  Sparkles,
  CheckCircle,
  Circle,
  Clock,
  DollarSign,
  Users,
  Eye,
  Send,
  Sliders,
  Compass,
  PackageCheck,
  Building,
  HelpCircle,
  FileCheck,
} from "lucide-react";

interface StructuredBrief {
  clientName: string;
  headcount: number;
  departments: string;
  targetBudget: string;
  spaceRequirements: string;
  notes: string;
}

const INITIAL_BRIEF: StructuredBrief = {
  clientName: "Sanlam Financial Services",
  headcount: 140,
  departments: "Executive Suites (12), Wealth Management (45), Open Collaboration Zone (60), Boardrooms (3)",
  targetBudget: "R 4,800,000",
  spaceRequirements: "2,200 m² across 2 floors with acoustic zoning and high-density power access",
  notes: "Client emphasizes warm neutral finishes, acoustic felt wall panelling, and indigenous Cape flora biophilic accents.",
};

export function ProjectWorkspace() {
  const [activePhaseKey, setActivePhaseKey] = useState<string>("discovery");
  const [briefData, setBriefData] = useState<StructuredBrief>(INITIAL_BRIEF);
  const [waitingOn, setWaitingOn] = useState<"me" | "someone_else">("me");
  const [aiChatMessages, setAiChatMessages] = useState<
    Array<{ sender: "user" | "ai"; text: string; cost?: string }>
  >([
    {
      sender: "ai",
      text: "Hello Andre! I have loaded the Sanlam HQ Discovery context. Would you like me to synthesize the meeting audio into the structured brief fields?",
      cost: "Context loaded · $0.00",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [, startTransition] = useTransition();

  // Phase tasks state with real-time toggle
  const [phaseTasks, setPhaseTasks] = useState<Record<string, Array<{ id: string; text: string; done: boolean; essential: boolean }>>>({
    discovery: [
      { id: "disc-01", text: "Site visit and initial walk-through completed", done: true, essential: true },
      { id: "disc-02", text: "Client headcount and department requirements logged", done: true, essential: true },
      { id: "disc-03", text: "Target fit-out budget and milestones confirmed", done: false, essential: true },
      { id: "disc-04", text: "Meeting notes uploaded and structured brief verified", done: false, essential: false },
    ],
    space_planning: [
      { id: "sp-01", text: "Floor plate geometry and boundaries calibrated", done: false, essential: true },
      { id: "sp-02", text: "Workstation clusters and circulation paths placed", done: false, essential: true },
      { id: "sp-03", text: "Usable area metrics and clear egress paths confirmed", done: false, essential: true },
    ],
    concept: [
      { id: "cpt-01", text: "Design direction and mood board curated", done: false, essential: true },
      { id: "cpt-02", text: "Material and finish palette tagged for downstream sourcing", done: false, essential: true },
    ],
    documentation: [
      { id: "doc-01", text: "Schedules populated from tagged concept items", done: false, essential: true },
      { id: "doc-02", text: "Fire safety and accessibility compliance pre-check confirmed", done: false, essential: true },
    ],
    sourcing: [
      { id: "src-01", text: "RFQs drafted and dispatched to verified suppliers", done: false, essential: true },
      { id: "src-02", text: "Quotes vetted against project budget baseline", done: false, essential: true },
      { id: "src-03", text: "Purchase orders approved and tracked", done: false, essential: true },
    ],
    delivery: [
      { id: "del-01", text: "On-site installation order sequence confirmed", done: false, essential: true },
      { id: "del-02", text: "Snag list inspection cleared with photos", done: false, essential: true },
      { id: "del-03", text: "Client walkthrough approved and handover dossier delivered", done: false, essential: true },
    ],
  });

  // Real-time SSE Channel integration
  const { status: connectionStatus, broadcast } = useRealtimeChannel({
    projectId: "sanlam-hq-01",
    onEvent: (event) => {
      if (event.type === "TASK_TOGGLED") {
        const { taskId, done, phaseKey } = event.data as { taskId: string; done: boolean; phaseKey: string };
        setPhaseTasks((prev) => ({
          ...prev,
          [phaseKey]: prev[phaseKey]?.map((t) => (t.id === taskId ? { ...t, done } : t)) ?? [],
        }));
      }
      if (event.type === "WAITING_ON_TOGGLED") {
        setWaitingOn(event.data as "me" | "someone_else");
      }
    },
  });

  // Auto-Save Engine (Saves on typing without manual save button)
  const { status: saveStatus, lastSavedAt } = useAutoSave({
    value: briefData,
    debounceMs: 800,
    onSave: async (savedVal) => {
      // Simulate direct serverless DB save to Neon
      await new Promise((res) => setTimeout(res, 350));
      // Broadcast real-time event to collaborators
      broadcast("RECORD_AUTOSAVED", savedVal, activePhaseKey);
    },
  });

  // Compute phase bar states
  const phasesInfo: PhaseInfo[] = workflowDefinition.phases.map((p) => {
    const tasks = phaseTasks[p.key] || [];
    const essentials = tasks.filter((t) => t.essential);
    const essentialDone = essentials.filter((t) => t.done).length;
    const isCompleted = essentials.length > 0 && essentialDone === essentials.length;

    let state: "completed" | "active" | "not_started" = "not_started";
    if (p.key === activePhaseKey) {
      state = "active";
    } else if (isCompleted) {
      state = "completed";
    }

    return {
      key: p.key,
      name: p.name,
      state,
      essentialDoneCount: essentialDone,
      essentialTotalCount: essentials.length,
    };
  });

  const activePhaseTasks = phaseTasks[activePhaseKey] || [];
  const activeEssentials = activePhaseTasks.filter((t) => t.essential);
  const canAdvance = activeEssentials.length > 0 && activeEssentials.every((t) => t.done);

  const toggleTask = (taskId: string) => {
    const updated = activePhaseTasks.map((t) =>
      t.id === taskId ? { ...t, done: !t.done } : t
    );
    const target = updated.find((t) => t.id === taskId);

    setPhaseTasks((prev) => ({
      ...prev,
      [activePhaseKey]: updated,
    }));

    if (target) {
      broadcast("TASK_TOGGLED", { taskId, done: target.done, phaseKey: activePhaseKey });
    }
  };

  const handleAdvancePhase = () => {
    const currentIndex = workflowDefinition.phases.findIndex((p) => p.key === activePhaseKey);
    if (currentIndex < workflowDefinition.phases.length - 1) {
      const nextPhase = workflowDefinition.phases[currentIndex + 1];
      startTransition(() => {
        setActivePhaseKey(nextPhase.key);
      });
      broadcast("PHASE_CHANGED", { nextPhaseKey: nextPhase.key });
    }
  };

  const toggleWaitingOn = () => {
    const nextVal = waitingOn === "me" ? "someone_else" : "me";
    setWaitingOn(nextVal);
    broadcast("WAITING_ON_TOGGLED", nextVal);
  };

  const handleSendAiMessage = () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatInput("");
    setAiChatMessages((prev) => [...prev, { sender: "user", text: userMsg }]);
    setIsAiThinking(true);

    setTimeout(() => {
      setIsAiThinking(false);
      setAiChatMessages((prev) => [
        ...prev,
        {
          sender: "ai",
          text: `Processed with project context: Updated brief draft with "${userMsg.substring(0, 30)}..." and checked egress clearances.`,
          cost: "Worker Tier (Flash 3.8) · $0.0018 logged",
        },
      ]);
    }, 900);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-app)" }}>
      {/* 1. Header with live SSE pulse and Auto-Save Status */}
      <Header
        saveStatus={saveStatus}
        lastSavedAt={lastSavedAt}
        connectionStatus={connectionStatus}
        workspaceName="Andre Swanepoel Interiors"
        projectName="Sanlam Cape Town HQ Fit-Out"
      />

      {/* 2. Persistent 6-Phase Bar */}
      <PhaseBar
        phases={phasesInfo}
        activePhaseKey={activePhaseKey}
        onSelectPhase={(key) => setActivePhaseKey(key)}
        onAdvancePhase={handleAdvancePhase}
        canAdvance={canAdvance}
      />

      {/* Project Meta Bar (Waiting-on tag & Quick stats) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.65rem 1.5rem",
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border-subtle)",
          fontSize: "0.82rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ color: "var(--text-muted)" }}>Status:</span>
            <button
              onClick={toggleWaitingOn}
              className={`badge ${waitingOn === "me" ? "badge-waiting-me" : "badge-waiting-them"}`}
              style={{ cursor: "pointer", border: "1px solid", outline: "none" }}
              title="Click to toggle waiting status without page reload"
            >
              <Clock size={11} />
              {waitingOn === "me" ? "Waiting on Me" : "Waiting on Client"}
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--text-muted)" }}>
            <Building size={14} />
            <span>Target: 2,200 m² Corporate Floor Plate</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--text-muted)" }}>
            <DollarSign size={14} color="var(--status-saved)" />
            <span>Budget: R 4.8M Cap</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
            AI Cost Logged: <strong style={{ color: "var(--accent-cyan)" }}>$0.0124 (R 0.22)</strong>
          </span>
          <button className="btn btn-ghost" style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}>
            <HelpCircle size={13} />
            Report Issue
          </button>
        </div>
      </div>

      {/* 3. Main 3-Column Phase Workspace */}
      <main
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "280px 1fr 340px",
          gap: "1px",
          background: "var(--border-subtle)",
          overflow: "hidden",
        }}
      >
        {/* Left Column: Documents & Uploads */}
        <section
          style={{
            background: "var(--bg-surface)",
            padding: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
            overflowY: "auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <FileText size={15} color="var(--accent-primary)" />
              Phase Documents
            </h3>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>4 files</span>
          </div>

          {/* Upload Dropzone */}
          <div
            style={{
              border: "1px dashed var(--border-medium)",
              borderRadius: "var(--radius-md)",
              padding: "1.25rem 1rem",
              textAlign: "center",
              background: "hsla(220, 20%, 13%, 0.4)",
              cursor: "pointer",
              transition: "border-color var(--transition-fast)",
            }}
          >
            <UploadCloud size={24} color="var(--accent-primary)" style={{ margin: "0 auto 0.5rem" }} />
            <p style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-primary)" }}>
              Upload Notes & CAD Plans
            </p>
            <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
              PDF, DWG, DOCX up to 50MB
            </p>
          </div>

          {/* Document list */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {[
              { name: "Client_Discovery_Notes.docx", size: "1.4 MB", clientVisible: false, date: "Today, 08:30" },
              { name: "Floor_Plate_Level_4.dwg", size: "24.8 MB", clientVisible: false, date: "Yesterday" },
              { name: "Acoustic_Guidelines_v1.pdf", size: "3.2 MB", clientVisible: true, date: "Oct 04" },
              { name: "Executive_Brief_Summary.pdf", size: "850 KB", clientVisible: true, date: "Just now" },
            ].map((doc, i) => (
              <div
                key={i}
                style={{
                  padding: "0.75rem",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-surface-elevated)",
                  border: "1px solid var(--border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.35rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span
                    style={{
                      fontSize: "0.78rem",
                      fontWeight: 500,
                      color: "var(--text-primary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: "180px",
                    }}
                  >
                    {doc.name}
                  </span>
                  {doc.clientVisible && (
                    <span
                      title="Shared with client"
                      style={{ fontSize: "0.68rem", color: "var(--accent-cyan)", display: "flex", alignItems: "center", gap: "0.2rem" }}
                    >
                      <Eye size={12} />
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--text-muted)" }}>
                  <span>{doc.size}</span>
                  <span>{doc.date}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Center Column: Live Working Area (No Reload Auto-Saving Engine) */}
        <section
          style={{
            background: "var(--bg-app)",
            padding: "1.5rem",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "1.5rem",
          }}
        >
          {activePhaseKey === "discovery" && (
            <div className="card" style={{ padding: "1.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem" }}>
                <div>
                  <h2 style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text-primary)" }}>
                    Structured Design Brief
                  </h2>
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    Real-time collaborative brief. Edits save automatically without manual confirmation.
                  </p>
                </div>
                <span className={`autosave-badge ${saveStatus}`}>
                  {saveStatus === "saving" ? "Saving to Neon..." : "Synced with Neon DB"}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                    Client Entity Name
                  </label>
                  <input
                    type="text"
                    value={briefData.clientName}
                    onChange={(e) => setBriefData({ ...briefData, clientName: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "0.6rem 0.85rem",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-surface-elevated)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-primary)",
                      fontSize: "0.85rem",
                      outline: "none",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                    Total Headcount Target
                  </label>
                  <input
                    type="number"
                    value={briefData.headcount}
                    onChange={(e) => setBriefData({ ...briefData, headcount: Number(e.target.value) })}
                    style={{
                      width: "100%",
                      padding: "0.6rem 0.85rem",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-surface-elevated)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-primary)",
                      fontSize: "0.85rem",
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              <div style={{ marginTop: "1rem" }}>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                  Department Adjacencies & Grouping
                </label>
                <textarea
                  rows={2}
                  value={briefData.departments}
                  onChange={(e) => setBriefData({ ...briefData, departments: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.6rem 0.85rem",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-surface-elevated)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-primary)",
                    fontSize: "0.85rem",
                    outline: "none",
                    resize: "vertical",
                  }}
                />
              </div>

              <div style={{ marginTop: "1rem" }}>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                  Target Fit-out Budget (ZAR)
                </label>
                <input
                  type="text"
                  value={briefData.targetBudget}
                  onChange={(e) => setBriefData({ ...briefData, targetBudget: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.6rem 0.85rem",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-surface-elevated)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-primary)",
                    fontSize: "0.85rem",
                    outline: "none",
                  }}
                />
              </div>

              <div style={{ marginTop: "1rem" }}>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                  Materiality & Acoustic Notes
                </label>
                <textarea
                  rows={3}
                  value={briefData.notes}
                  onChange={(e) => setBriefData({ ...briefData, notes: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.6rem 0.85rem",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-surface-elevated)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-primary)",
                    fontSize: "0.85rem",
                    outline: "none",
                    resize: "vertical",
                  }}
                />
              </div>
            </div>
          )}

          {activePhaseKey === "space_planning" && (
            <div className="card" style={{ padding: "1.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                <div>
                  <h2 style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text-primary)" }}>
                    Floor Plan & Spatial Layout Engine
                  </h2>
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    Floor plate Level 4 (2,200 m²). Auto-calibrated against designer clearance rules.
                  </p>
                </div>
                <button className="btn btn-primary" style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}>
                  <Sparkles size={14} />
                  Generate 3 Layout Options
                </button>
              </div>

              <div
                style={{
                  height: "280px",
                  background: "hsl(222, 24%, 4%)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-medium)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  gap: "0.75rem",
                }}
              >
                <Compass size={36} color="var(--accent-primary)" />
                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  Floor Plate Canvas Viewer (Pan & Zoom Active)
                </span>
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                  Click walls or spaces to adjust dimensions • Live auto-save enabled
                </span>
              </div>
            </div>
          )}

          {activePhaseKey !== "discovery" && activePhaseKey !== "space_planning" && (
            <div className="card" style={{ padding: "1.5rem", textAlign: "center" }}>
              <PackageCheck size={36} color="var(--accent-cyan)" style={{ margin: "0 auto 0.75rem" }} />
              <h3 style={{ fontSize: "1.05rem", fontWeight: 600, color: "var(--text-primary)" }}>
                {phasesInfo.find((p) => p.key === activePhaseKey)?.name} Workspace
              </h3>
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", maxWidth: "450px", margin: "0.5rem auto 1rem" }}>
                Generic module components load seamlessly according to the workflow definition v1. Context flows forward through handoffs automatically.
              </p>
            </div>
          )}
        </section>

        {/* Right Column: Real-Time Checklist & AI Assistant */}
        <section
          style={{
            background: "var(--bg-surface)",
            padding: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
            overflowY: "auto",
          }}
        >
          {/* Phase Quality Gate Checklist */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
              <h3 style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <CheckCircle size={15} color="var(--accent-cyan)" />
                Phase Quality Gate
              </h3>
              <span style={{ fontSize: "0.72rem", color: canAdvance ? "var(--status-saved)" : "var(--status-saving)" }}>
                {canAdvance ? "Gate Unlocked" : "In Progress"}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {activePhaseTasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => toggleTask(task.id)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.6rem",
                    padding: "0.6rem 0.75rem",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-surface-elevated)",
                    border: "1px solid var(--border-subtle)",
                    cursor: "pointer",
                    transition: "all var(--transition-fast)",
                  }}
                >
                  <div style={{ marginTop: "2px" }}>
                    {task.done ? (
                      <CheckCircle size={16} color="var(--status-saved)" />
                    ) : (
                      <Circle size={16} color="var(--text-muted)" />
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                    <span
                      style={{
                        fontSize: "0.78rem",
                        color: task.done ? "var(--text-muted)" : "var(--text-primary)",
                        textDecoration: task.done ? "line-through" : "none",
                        lineHeight: 1.3,
                      }}
                    >
                      {task.text}
                    </span>
                    {task.essential && (
                      <span style={{ fontSize: "0.66rem", color: "var(--accent-primary)", marginTop: "2px" }}>
                        Essential for Gate Advance
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Co-Pilot Chat */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              borderTop: "1px solid var(--border-subtle)",
              paddingTop: "1rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <Sparkles size={15} color="var(--accent-primary)" />
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)" }}>
                  AI Assistant
                </span>
              </div>
              <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Worker: Gemini 3.8 Flash</span>
            </div>

            {/* Chat message history */}
            <div
              style={{
                flex: 1,
                minHeight: "180px",
                maxHeight: "260px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "0.6rem",
                padding: "0.5rem 0",
              }}
            >
              {aiChatMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    padding: "0.65rem 0.8rem",
                    borderRadius: "var(--radius-sm)",
                    background: msg.sender === "user" ? "var(--accent-primary)" : "var(--bg-surface-elevated)",
                    color: msg.sender === "user" ? "#ffffff" : "var(--text-primary)",
                    alignSelf: msg.sender === "user" ? "flex-end" : "flex-start",
                    maxWidth: "90%",
                    fontSize: "0.78rem",
                    border: msg.sender === "user" ? "none" : "1px solid var(--border-subtle)",
                  }}
                >
                  <div>{msg.text}</div>
                  {msg.cost && (
                    <div style={{ fontSize: "0.65rem", color: "var(--accent-cyan)", marginTop: "4px" }}>
                      {msg.cost}
                    </div>
                  )}
                </div>
              ))}
              {isAiThinking && (
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                  Synthesizing and running compliance check...
                </div>
              )}
            </div>

            {/* Chat Input */}
            <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }}>
              <input
                type="text"
                placeholder="Ask co-pilot or synthesize notes..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendAiMessage()}
                style={{
                  flex: 1,
                  padding: "0.55rem 0.75rem",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-surface-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                  fontSize: "0.78rem",
                  outline: "none",
                }}
              />
              <button
                onClick={handleSendAiMessage}
                className="btn btn-primary"
                style={{ padding: "0.55rem 0.75rem" }}
              >
                <Send size={13} />
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
