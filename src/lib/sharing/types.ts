import type { Plan } from "@/lib/plan/geometry";
import type { DesignBoard } from "@/lib/design/schema";

export type ShareTargetType =
  "document" | "brief" | "plan" | "board" | "schedule";
export type ShareMode = "live" | "snapshot";
export type SharePermission = "view" | "comment" | "edit" | "approve";
export interface ShareApproval {
  id: string;
  authorName: string;
  decision: "approved" | "changes_requested";
  note: string;
  createdAt: string;
}
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
  approval?: ShareApproval | null;
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
  | { type: "board"; board: DesignBoard; imageUrls: Record<string, string> }
  | {
      type: "schedule";
      items: {
        id: string;
        name: string;
        category: string;
        tags: string[];
        specification: string;
        dimensions: string;
        quantity: number;
        documentId: string | null;
      }[];
      imageUrls: Record<string, string>;
    }
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
  approvals?: ShareApproval[];
}
export interface ProjectShares {
  links: ShareLink[];
  targets: ShareTarget[];
  phases: { key: string; name: string; clientVisible: boolean }[];
}
