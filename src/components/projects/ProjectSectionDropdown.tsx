"use client";

import React, { useState, useRef, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  Check,
  Map,
  LayoutGrid,
  FileText,
  Palette,
  Armchair,
  ShieldCheck,
  MessageSquareQuote,
  Sparkles,
  FolderOpen,
  MessagesSquare,
  Users,
  Eye,
  Coins,
  Download,
  Copy,
  Settings,
  Compass,
  Layers,
  Bot,
  ListOrdered,
  PenLine,
} from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import {
  projectSections,
  activeProjectSection,
  type ProjectSection,
} from "@/lib/studio/project-navigation";
import type { Project } from "@/lib/studio/types";

export interface ProjectSectionDropdownProps {
  project: Project;
  beforeNavigate?: () => Promise<boolean>;
  compact?: boolean;
}

function getSectionIcon(href: string, label: string) {
  const h = href.toLowerCase();
  const l = label.toLowerCase();

  if (h.endsWith("/plan") || l.includes("floor plan")) return Map;
  if (h.endsWith("/layout") || l.includes("layout")) return LayoutGrid;
  if (h.includes("/brief") || l.includes("brief")) return FileText;
  if (h.includes("/boards") || l.includes("board") || l.includes("moodboard")) return Palette;
  if (h.includes("/concepts") || l.includes("concept")) return Sparkles;
  if (h.includes("/items") || l.includes("item") || l.includes("schedule") || l.includes("palette")) return Armchair;
  if (h.includes("/regulations")) return ShieldCheck;
  if (h.includes("/rfqs") || l.includes("quote")) return MessageSquareQuote;
  if (h.includes("/documents")) return FolderOpen;
  if (h.includes("/conversations")) return MessagesSquare;
  if (h.includes("/team")) return Users;
  if (h.includes("/client")) return Eye;
  if (h.includes("/autopilot")) return Bot;
  if (h.includes("/ai")) return Coins;
  if (h.includes("/export")) return Download;
  if (h.includes("/templates")) return Copy;
  if (h.includes("/settings")) return Settings;
  if (h.includes("/phases")) return ListOrdered;
  if (h.includes("/notes")) return PenLine;
  if (l.includes("overview") || href.split("/").filter(Boolean).length <= 2) return Compass;

  return Layers;
}

export function ProjectSectionDropdown({
  project,
  beforeNavigate,
  compact = false,
}: ProjectSectionDropdownProps) {
  const { viewer } = useStudio();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const sections = projectSections(project, viewer);
  const currentHref = activeProjectSection(sections, pathname);
  const currentSection = sections.find((s) => s.href === currentHref) || sections[0];

  const CurrentIcon = getSectionIcon(currentSection?.href || "", currentSection?.label || "");

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleSelect = async (section: ProjectSection) => {
    setOpen(false);
    if (section.href === currentHref) return;

    setBusy(true);
    try {
      if (!beforeNavigate || (await beforeNavigate())) {
        router.push(section.href);
      }
    } finally {
      setBusy(false);
    }
  };

  // Group sections logically
  const workflowGroup = sections.filter((s) => {
    const h = s.href.toLowerCase();
    return (
      h.includes("/brief") ||
      h.includes("/plan") ||
      h.includes("/layout") ||
      h.includes("/boards") ||
      h.includes("/concepts") ||
      h.includes("/items") ||
      h.includes("/regulations") ||
      h.includes("/notes")
    );
  });

  const projectGroup = sections.filter((s) => {
    const h = s.href.toLowerCase();
    return (
      h.endsWith(`/${project.id}`) ||
      h.includes("/phases") ||
      h.includes("/documents") ||
      h.includes("/conversations") ||
      h.includes("/team") ||
      h.includes("/client") ||
      h.includes("/rfqs")
    );
  });

  const settingsGroup = sections.filter((s) => {
    return !workflowGroup.includes(s) && !projectGroup.includes(s);
  });

  return (
    <div
      ref={dropdownRef}
      className={`project-section-dropdown${compact ? " compact" : ""}`}
    >
      <button
        type="button"
        className={`section-dropdown-trigger${busy ? " is-busy" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch project section"
        disabled={busy}
      >
        <span className="section-trigger-icon">
          <CurrentIcon size={14} />
        </span>
        <span className="section-trigger-content">
          {!compact && (
            <span className="section-project-title truncate">
              {project.name}
            </span>
          )}
          <span className="section-current-label truncate">
            {currentSection?.label || "Select section"}
          </span>
        </span>
        <ChevronDown size={13} className={`section-trigger-chevron${open ? " is-open" : ""}`} />
      </button>

      {open && (
        <div className="section-dropdown-popover" role="listbox">
          <div className="section-dropdown-scroll">
            {workflowGroup.length > 0 && (
              <div className="section-group">
                <div className="section-group-title">Design & Workflow</div>
                {workflowGroup.map((sec) => {
                  const Icon = getSectionIcon(sec.href, sec.label);
                  const isSelected = sec.href === currentHref;
                  return (
                    <button
                      key={sec.href}
                      type="button"
                      className={`section-item${isSelected ? " active" : ""}`}
                      onClick={() => handleSelect(sec)}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <Icon size={14} className="section-item-icon" />
                      <span className="section-item-label truncate">{sec.label}</span>
                      {isSelected && <Check size={14} className="section-item-check" />}
                    </button>
                  );
                })}
              </div>
            )}

            {projectGroup.length > 0 && (
              <div className="section-group">
                <div className="section-group-title">Project & Team</div>
                {projectGroup.map((sec) => {
                  const Icon = getSectionIcon(sec.href, sec.label);
                  const isSelected = sec.href === currentHref;
                  return (
                    <button
                      key={sec.href}
                      type="button"
                      className={`section-item${isSelected ? " active" : ""}`}
                      onClick={() => handleSelect(sec)}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <Icon size={14} className="section-item-icon" />
                      <span className="section-item-label truncate">{sec.label}</span>
                      {isSelected && <Check size={14} className="section-item-check" />}
                    </button>
                  );
                })}
              </div>
            )}

            {settingsGroup.length > 0 && (
              <div className="section-group">
                <div className="section-group-title">Settings & Tools</div>
                {settingsGroup.map((sec) => {
                  const Icon = getSectionIcon(sec.href, sec.label);
                  const isSelected = sec.href === currentHref;
                  return (
                    <button
                      key={sec.href}
                      type="button"
                      className={`section-item${isSelected ? " active" : ""}`}
                      onClick={() => handleSelect(sec)}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <Icon size={14} className="section-item-icon" />
                      <span className="section-item-label truncate">{sec.label}</span>
                      {isSelected && <Check size={14} className="section-item-check" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
