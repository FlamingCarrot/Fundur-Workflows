import type { IssueStatus } from "@/lib/studio/types";
import type { TicketMessage } from "@/lib/issues/store";

/** What a person can ask for help with. */
export const SUPPORT_TOPICS = {
  getting_started: "Getting started",
  how_to: "How do I…",
  account: "My account",
  idea: "An idea or request",
  other: "Something else",
} as const;

export type SupportTopic = keyof typeof SUPPORT_TOPICS;

export interface SupportRequest {
  id: string;
  topic: SupportTopic;
  subject: string;
  status: IssueStatus;
  /** The conversation, oldest first; the first message is the request itself. */
  messages: TicketMessage[];
  /** The Admin has replied since the person last opened it. */
  unread: boolean;
  createdAt: string;
  updatedAt: string;
}
