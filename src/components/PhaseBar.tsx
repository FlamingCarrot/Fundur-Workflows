"use client";

import React from "react";
import { Check, ArrowRight, Lock } from "lucide-react";

export interface PhaseInfo {
  key: string;
  name: string;
  state: "completed" | "active" | "not_started";
  essentialDoneCount: number;
  essentialTotalCount: number;
}

interface PhaseBarProps {
  phases: PhaseInfo[];
  activePhaseKey: string;
  onSelectPhase: (phaseKey: string) => void;
  onAdvancePhase?: () => void;
  canAdvance?: boolean;
}

export function PhaseBar({
  phases,
  activePhaseKey,
  onSelectPhase,
  onAdvancePhase,
  canAdvance = false,
}: PhaseBarProps) {
  const activeIndex = phases.findIndex((p) => p.key === activePhaseKey);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "space-between",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-subtle)",
        position: "relative",
        overflowX: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "stretch", flex: 1 }}>
        {phases.map((phase, idx) => {
          const isActive = phase.key === activePhaseKey;
          const isCompleted = phase.state === "completed";
          const isUnlocked = isCompleted || isActive || idx <= activeIndex + 1;

          return (
            <button
              key={phase.key}
              onClick={() => isUnlocked && onSelectPhase(phase.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.65rem",
                padding: "0.85rem 1.25rem",
                background: isActive
                  ? "hsla(228, 85%, 63%, 0.08)"
                  : "transparent",
                border: "none",
                borderBottom: isActive
                  ? "2px solid var(--accent-primary)"
                  : "2px solid transparent",
                cursor: isUnlocked ? "pointer" : "not-allowed",
                opacity: isUnlocked ? 1 : 0.45,
                transition: "all var(--transition-fast)",
                textAlign: "left",
                outline: "none",
              }}
            >
              {/* Badge Icon / Number */}
              <div
                style={{
                  width: "22px",
                  height: "22px",
                  borderRadius: "var(--radius-full)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  background: isCompleted
                    ? "var(--status-saved)"
                    : isActive
                    ? "var(--accent-primary)"
                    : "var(--bg-surface-elevated)",
                  color: isCompleted || isActive ? "#ffffff" : "var(--text-muted)",
                  border: isCompleted || isActive
                    ? "none"
                    : "1px solid var(--border-medium)",
                  boxShadow: isActive ? "0 0 10px var(--accent-primary-glow)" : "none",
                }}
              >
                {isCompleted ? <Check size={13} strokeWidth={3} /> : idx + 1}
              </div>

              {/* Title & Progress info */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span
                  style={{
                    fontSize: "0.84rem",
                    fontWeight: isActive ? 600 : 500,
                    color: isActive
                      ? "var(--text-primary)"
                      : isCompleted
                      ? "var(--text-secondary)"
                      : "var(--text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {phase.name}
                </span>
                <span
                  style={{
                    fontSize: "0.68rem",
                    color: isCompleted
                      ? "var(--status-saved)"
                      : isActive
                      ? "var(--accent-cyan)"
                      : "var(--text-disabled)",
                  }}
                >
                  {isCompleted
                    ? "Phase Gate Passed"
                    : `${phase.essentialDoneCount}/${phase.essentialTotalCount} Essentials`}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Advance Phase Button (unlocked when essential checks pass) */}
      {onAdvancePhase && activeIndex < phases.length - 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "0 1rem",
            borderLeft: "1px solid var(--border-subtle)",
          }}
        >
          <button
            onClick={onAdvancePhase}
            disabled={!canAdvance}
            className={`btn ${canAdvance ? "btn-primary" : "btn-secondary"}`}
            style={{
              padding: "0.45rem 0.95rem",
              fontSize: "0.78rem",
              cursor: canAdvance ? "pointer" : "not-allowed",
              opacity: canAdvance ? 1 : 0.5,
            }}
            title={
              canAdvance
                ? "Complete this phase and move to the next stage"
                : "Complete all essential checklist items to unlock"
            }
          >
            {canAdvance ? (
              <>
                <span>Complete Phase</span>
                <ArrowRight size={14} />
              </>
            ) : (
              <>
                <Lock size={13} />
                <span>Gate Locked</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
