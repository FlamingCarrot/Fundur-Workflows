import { z } from "zod";

/**
 * A project's shared team space: a whiteboard with chats in it, and comments
 * that can sit on a phase, a step, the plan or a board. Each note, message and
 * comment is its own record, so people working at once never overwrite each other.
 */

/** Where a comment sits: "project", "phase:<key>", "step:<id>", "plan", "board:<key>" or "whiteboard". */
export const anchorSchema = z
  .string()
  .regex(/^(project|plan|whiteboard|(phase|step|board|document):[A-Za-z0-9_.:-]{1,100})$/);

export const NOTE_COLORS = ["#fff4b8", "#ffd9c7", "#d6ecd2", "#d5e4f5", "#eadcf5", "#ffffff"] as const;
export const BOARD_WIDTH = 2400;
export const BOARD_HEIGHT = 1600;

export const whiteboardNoteSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["note", "text", "heading"]),
    text: z.string().max(4000),
    color: z.enum(NOTE_COLORS),
    x: z.number().min(0).max(BOARD_WIDTH),
    y: z.number().min(0).max(BOARD_HEIGHT),
    w: z.number().min(80).max(800),
    h: z.number().min(40).max(800),
  })
  .strict();
export type WhiteboardNoteInput = z.infer<typeof whiteboardNoteSchema>;
export interface WhiteboardNote extends WhiteboardNoteInput {
  updatedAt: string;
  updatedBy: string;
}

export const whiteboardOpSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("put"), note: whiteboardNoteSchema }).strict(),
  z.object({ type: z.literal("remove"), id: z.uuid() }).strict(),
]);
export type WhiteboardOp = z.infer<typeof whiteboardOpSchema>;

export const newCommentSchema = z
  .object({
    anchor: anchorSchema,
    body: z.string().trim().min(1).max(5000),
    parentId: z.uuid().nullable().optional(),
  })
  .strict();
export const commentChangeSchema = z
  .object({ resolved: z.boolean() })
  .strict();

export interface TeamComment {
  id: string;
  anchor: string;
  parentId: string | null;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
}

export const newChatSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    /** Who is in it; empty means everyone on the project. */
    memberIds: z.array(z.string().min(1).max(255)).max(100),
  })
  .strict();
export const newMessageSchema = z
  .object({ body: z.string().trim().min(1).max(5000) })
  .strict();

export interface TeamChat {
  id: string;
  name: string;
  memberIds: string[];
  createdBy: string;
  createdAt: string;
  lastMessageAt: string | null;
}
export interface ChatMessage {
  id: string;
  chatId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** The chat everyone on a project is in; it always exists. */
export const EVERYONE_CHAT = "everyone";

export function inChat(chat: Pick<TeamChat, "memberIds" | "createdBy">, userId: string): boolean {
  return !chat.memberIds.length || chat.createdBy === userId || chat.memberIds.includes(userId);
}

/** A readable label for where a comment sits, e.g. "Step: Site visit". */
export function anchorKind(anchor: string): { kind: string; key: string } {
  const i = anchor.indexOf(":");
  return i < 0 ? { kind: anchor, key: "" } : { kind: anchor.slice(0, i), key: anchor.slice(i + 1) };
}
