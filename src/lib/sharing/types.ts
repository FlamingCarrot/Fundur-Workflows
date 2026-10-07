import type { Plan } from "@/lib/plan/geometry";

export type ShareTargetType = "document" | "brief" | "plan";
export type ShareMode = "live" | "snapshot";
export type SharePermission = "view" | "comment" | "edit";
export interface ShareTarget {
  type: ShareTargetType;
  id: string;
  name: string;
  phaseKey: string;
  clientVisible: boolean;
  available: boolean;
}
export interface ShareLink {
  id: string;
  targetType: ShareTargetType;
  targetId: string;
  title: string;
  mode: ShareMode;
  permission: SharePermission;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  available: boolean;
}
export interface ShareComment {
  id: string;
  parentId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  /** A studio reply, as opposed to a self-reported visitor name. */
  internal: boolean;
}
export type SharedContent =
  | { type: "brief"; fields: { key: string; label: string; value: string }[] }
  | { type: "plan"; plan: Plan; revision: number }
  | {
      type: "document";
      name: string;
      fileType: string;
      sizeBytes: number;
      version: number;
      fileUrl: string | null;
    };
export interface SharedPage {
  brand?: { name?: string; logoUrl?: string };
  share: {
    title: string;
    projectName: string;
    targetType: ShareTargetType;
    mode: ShareMode;
    permission: SharePermission;
    createdAt: string;
    expiresAt: string | null;
  };
  content: SharedContent;
  comments: ShareComment[];
}
export interface ProjectShares {
  links: ShareLink[];
  targets: ShareTarget[];
  phases: { key: string; name: string; clientVisible: boolean }[];
}
