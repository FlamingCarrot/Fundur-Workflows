"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronRight, ChevronDown } from "lucide-react";
import { getWorkflow } from "@/lib/workflow";
import { phaseState } from "@/lib/studio/selectors";
import { canSeePhase } from "@/lib/team/access";
import { DesignLink } from "@/components/design/DesignLink";
import type { Project } from "@/lib/studio/types";

export interface GlobalProcessStepperProps {
  project: Project;
  beforeNavigate?: () => Promise<boolean>;
  compact?: boolean;
}

export function GlobalProcessStepper({
  project,
  beforeNavigate,
  compact = false,
}: GlobalProcessStepperProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const workflow = getWorkflow(project);
  const phases = workflow.phases;

  // Find index of the phase matching pathname if on a phase page, or current project phase
  const currentPhaseIndex = phases.findIndex((p) => {
    const href = `/projects/${project.id}/phases/${p.key}`;
    return pathname === href || pathname.startsWith(`${href}/`);
  });

  const activeIndex = currentPhaseIndex >= 0
    ? currentPhaseIndex
    : phases.findIndex((p) => p.key === project.currentPhase);

  const activePhase = phases[activeIndex >= 0 ? activeIndex : 0];

  const handleStepClick = async (e: React.MouseEvent, href: string) => {
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      e.preventDefault();
      return;
    }
    if (beforeNavigate) {
      e.preventDefault();
      const ok = await beforeNavigate();
      if (ok) {
        router.push(href);
      }
    }
  };

  return (
    <nav
      className={`global-process-stepper${compact ? " stepper-compact" : ""}`}
      aria-label="Workflow progress stepper"
    >
      {/* Mobile / Tiny Viewport Dropdown Trigger */}
      <div className="stepper-mobile-wrapper">
        <button
          type="button"
          className="stepper-mobile-trigger"
          onClick={() => setMobileMenuOpen((v) => !v)}
          aria-expanded={mobileMenuOpen}
        >
          <span className="stepper-badge current">
            {activeIndex + 1}
          </span>
          <span className="stepper-mobile-label truncate">
            {activePhase?.name || "Workflow"}
          </span>
          <ChevronDown size={14} className="stepper-chevron" />
        </button>

        {mobileMenuOpen && (
          <>
            <div
              className="stepper-dropdown-backdrop"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="stepper-mobile-dropdown">
              <div className="stepper-dropdown-header">
                <span className="tiny muted uppercase tracking-wide">Project Workflow</span>
                <span className="tiny font-mono">{activeIndex + 1}/{phases.length}</span>
              </div>
              <div className="stepper-dropdown-list">
                {phases.map((phase, idx) => {
                  const isVisible = canSeePhase(project.myAccess, phase.key);
                  const state = phaseState(project, phase.key);
                  const href = `/projects/${project.id}/phases/${phase.key}`;
                  const isCurrent = idx === activeIndex;

                  if (!isVisible) return null;

                  return (
                    <Link
                      key={phase.key}
                      href={href}
                      onClick={(e) => {
                        setMobileMenuOpen(false);
                        handleStepClick(e, href);
                      }}
                      className={`stepper-dropdown-item${isCurrent ? " active" : ""}`}
                    >
                      <span className={`stepper-badge ${state}`}>
                        {state === "complete" ? <Check size={11} strokeWidth={2.5} /> : idx + 1}
                      </span>
                      <span className="stepper-dropdown-name">{phase.name}</span>
                      {isCurrent && <span className="stepper-active-dot" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Desktop & Inline Connected Stepper Track */}
      <div className="stepper-track">
        {phases.map((phase, idx) => {
          const isVisible = canSeePhase(project.myAccess, phase.key);
          if (!isVisible) return null;

          const state = phaseState(project, phase.key);
          const href = `/projects/${project.id}/phases/${phase.key}`;
          const isCurrent = idx === activeIndex;
          const isComplete = state === "complete";
          const isLast = idx === phases.length - 1;

          const stepBadge = (
            <span
              className={`stepper-badge ${state}${isCurrent ? " is-active" : ""}`}
              aria-hidden="true"
            >
              {isComplete ? (
                <Check size={11} strokeWidth={2.75} />
              ) : (
                idx + 1
              )}
            </span>
          );

          const stepContent = (
            <>
              {stepBadge}
              <span className="stepper-label">{phase.name}</span>
            </>
          );

          const titleText = `Phase ${idx + 1}: ${phase.name} (${
            state === "complete" ? "Completed" : isCurrent ? "Current phase" : "Upcoming"
          })`;

          return (
            <React.Fragment key={phase.key}>
              {beforeNavigate ? (
                <DesignLink
                  flush={beforeNavigate}
                  href={href}
                  className={`stepper-step ${state}${isCurrent ? " active" : ""}`}
                  aria-current={isCurrent ? "step" : undefined}
                  title={titleText}
                >
                  {stepContent}
                </DesignLink>
              ) : (
                <Link
                  href={href}
                  className={`stepper-step ${state}${isCurrent ? " active" : ""}`}
                  aria-current={isCurrent ? "step" : undefined}
                  title={titleText}
                >
                  {stepContent}
                </Link>
              )}

              {!isLast && (
                <span className="stepper-divider" aria-hidden="true">
                  <ChevronRight size={11} className="stepper-arrow" />
                </span>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </nav>
  );
}
