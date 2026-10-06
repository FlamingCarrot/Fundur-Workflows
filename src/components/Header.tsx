"use client";

import React from "react";
import { CheckCircle2, RefreshCw, AlertCircle, Radio, Sparkles, Layers } from "lucide-react";
import { SaveStatus } from "@/hooks/useAutoSave";
import { ConnectionStatus } from "@/hooks/useRealtimeChannel";

interface HeaderProps {
  saveStatus?: SaveStatus;
  lastSavedAt?: Date | null;
  connectionStatus?: ConnectionStatus;
  workspaceName?: string;
  projectName?: string;
}

export function Header({
  saveStatus = "saved",
  lastSavedAt,
  connectionStatus = "connected",
  workspaceName = "Design Studio",
  projectName = "Sanlam Cape Town HQ Fit-Out",
}: HeaderProps) {
  const formatTime = (date: Date | null) => {
    if (!date) return "just now";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.75rem 1.5rem",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-subtle)",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      {/* Brand & Project Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontWeight: 700,
            fontSize: "1rem",
            color: "var(--text-primary)",
            letterSpacing: "-0.02em",
          }}
        >
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "var(--radius-sm)",
              background: "linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 12px var(--accent-primary-glow)",
            }}
          >
            <Layers size={16} color="#ffffff" />
          </div>
          <span>Fundur</span>
          <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>/</span>
          <span style={{ color: "var(--text-secondary)", fontWeight: 500, fontSize: "0.9rem" }}>
            {workspaceName}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            background: "var(--bg-surface-elevated)",
            padding: "0.25rem 0.65rem",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-subtle)",
            fontSize: "0.82rem",
            color: "var(--text-primary)",
            fontWeight: 500,
          }}
        >
          <span style={{ color: "var(--accent-primary)" }}>●</span>
          {projectName}
        </div>
      </div>

      {/* Real-Time Sync & Auto-Save Center / Right Status */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        {/* Real-time Connection Indicator */}
        <div
          className="live-pulse"
          title={`Real-time sync: ${connectionStatus}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.45rem",
            padding: "0.3rem 0.65rem",
            background: "hsla(220, 20%, 14%, 0.5)",
            borderRadius: "var(--radius-full)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <span
            className={`pulse-dot ${
              connectionStatus === "connected"
                ? ""
                : connectionStatus === "reconnecting"
                ? "reconnecting"
                : "offline"
            }`}
          />
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            {connectionStatus === "connected"
              ? "Live Real-Time Sync"
              : connectionStatus === "reconnecting"
              ? "Reconnecting..."
              : "Offline"}
          </span>
        </div>

        {/* Unobtrusive Auto-Save Indicator (No save button needed) */}
        <div
          className={`autosave-badge ${saveStatus}`}
          title="All changes save automatically to Neon database"
        >
          {saveStatus === "saving" && (
            <>
              <RefreshCw size={13} className="animate-spin" />
              <span>Saving...</span>
            </>
          )}
          {saveStatus === "saved" && (
            <>
              <CheckCircle2 size={13} color="var(--status-saved)" />
              <span>All changes saved {lastSavedAt ? `(${formatTime(lastSavedAt)})` : ""}</span>
            </>
          )}
          {saveStatus === "dirty" && (
            <>
              <Radio size={13} color="var(--text-muted)" />
              <span>Unsaved edits...</span>
            </>
          )}
          {saveStatus === "error" && (
            <>
              <AlertCircle size={13} color="var(--status-error)" />
              <span>Failed to save - retrying</span>
            </>
          )}
        </div>

        {/* User Identity / Role Pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            paddingLeft: "0.75rem",
            borderLeft: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "var(--radius-full)",
              background: "hsla(228, 85%, 63%, 0.2)",
              border: "1px solid var(--border-highlight)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "var(--accent-primary)",
            }}
          >
            AS
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-primary)" }}>
              Andre Swanepoel
            </span>
            <span style={{ fontSize: "0.68rem", color: "var(--accent-cyan)", textTransform: "capitalize" }}>
              Workspace Owner (IID Designer)
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
