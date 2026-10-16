import React from "react";
import { Check, FileText, Hammer, LayoutGrid, ListChecks, MessageSquare, PenLine, Ruler } from "lucide-react";
import { label } from "@/lib/workflow";
import { getRegisteredModule, parseModuleRef } from "@/lib/modules/registry";
import type { Project } from "@/lib/studio/types";

/**
 * Where a module opens and what it is called on a project. Any phase or step
 * can carry a module, so a step's links and project settings name and link
 * modules through this one place.
 */
export interface ModuleTarget {
  title: string;
  /** Where it opens; absent when it has no screen of its own. */
  href?: string;
  icon: React.ReactNode;
}

export function moduleTarget(project: Project, ref: string, phaseKey?: string): ModuleTarget {
  const { key: base, variant } = parseModuleRef(ref);
  const mod = getRegisteredModule(ref);
  const named = variant ? label(project, variant, mod?.name ?? variant) : mod?.name ?? base;
  const at = (path: string) => `/projects/${project.id}${path}`;
  switch (base) {
    case "structured_form":
      return variant === "brief"
        ? { title: label(project, "brief", "Brief"), href: at("/brief"), icon: <PenLine size={16} /> }
        : { title: named, href: variant ? at(`/forms/${variant}`) : undefined, icon: <PenLine size={16} /> };
    case "notes":
      return { title: "Phase notes", href: phaseKey ? at(`/forms/notes:${phaseKey}`) : undefined, icon: <PenLine size={16} /> };
    case "documents":
      return { title: "Documents", href: at("/documents"), icon: <FileText size={16} /> };
    case "layout_generator":
      return { title: label(project, "layout_generator", mod?.name ?? base), href: at("/layout"), icon: <LayoutGrid size={16} /> };
    case "floor_plan_editor":
      if (variant === "game_assets") return { title: named, href: at("/assets"), icon: <Hammer size={16} /> };
      return { title: named, href: at("/plan"), icon: <Ruler size={16} /> };
    case "canvas_board":
      return { title: named, href: variant ? at(`/boards/${variant}`) : undefined, icon: <LayoutGrid size={16} /> };
    case "item_register":
      return { title: named, href: variant ? at(`/items/${variant}`) : undefined, icon: <LayoutGrid size={16} /> };
    case "regulatory_checklist":
      return { title: mod?.name ?? "Regulation checklist", href: at("/regulations"), icon: <Check size={16} /> };
    case "message_drafter":
      return { title: "Quote requests", href: at("/rfqs"), icon: <PenLine size={16} /> };
    case "link_importer":
      return { title: mod?.name ?? "Link importer", href: at("/items/register"), icon: <PenLine size={16} /> };
    case "template_export":
      return { title: mod?.name ?? "Template and export", href: at("/templates"), icon: <LayoutGrid size={16} /> };
    case "tasks_calendar":
      return { title: mod?.name ?? "Tasks and calendar", href: "/timeline", icon: <LayoutGrid size={16} /> };
    case "sharing":
    case "comments":
      return { title: mod?.name ?? base, href: at("/documents#sharing-heading"), icon: <FileText size={16} /> };
    case "checklist":
      return { title: mod?.name ?? "Steps", icon: <ListChecks size={16} /> };
    case "ai_chat":
      return { title: mod?.name ?? "Assistant", icon: <MessageSquare size={16} /> };
    default:
      return { title: named, icon: <Hammer size={16} /> };
  }
}
