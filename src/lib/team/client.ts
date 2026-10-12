"use client";
import type { ClientInvite, ClientViewSettings } from "./client-view";
import type { ProjectAccess } from "./access";
import {
  EVERYONE_CHAT,
  type ChatMessage,
  type TeamChat,
  type TeamComment,
  type TeamMember,
  type WhiteboardNote,
  type WhiteboardOp,
} from "./space";

/**
 * The team space as the browser reaches it: the server when projects are
 * stored there, otherwise this browser's own storage for the open demo, where
 * there is only one person and nothing to share with.
 */
export interface TeamBackend {
  comments(): Promise<TeamComment[]>;
  addComment(input: { anchor: string; body: string; parentId?: string | null }): Promise<TeamComment>;
  resolveComment(id: string, resolved: boolean): Promise<TeamComment>;
  deleteComment(id: string): Promise<void>;
  notes(): Promise<WhiteboardNote[]>;
  changeNote(op: WhiteboardOp): Promise<void>;
  chats(): Promise<TeamChat[]>;
  createChat(input: { name: string; memberIds: string[] }): Promise<TeamChat>;
  messages(chatId: string): Promise<ChatMessage[]>;
  post(chatId: string, body: string): Promise<ChatMessage>;
}

export interface TeamPerson {
  id: string;
  name: string;
}

export async function teamRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "That didn't work. Please retry.");
  return body as T;
}

function serverBackend(projectId: string): TeamBackend {
  const base = `/api/projects/${encodeURIComponent(projectId)}`;
  const send = <T,>(path: string, method: string, body?: unknown) =>
    teamRequest<T>(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    comments: async () => (await teamRequest<{ comments: TeamComment[] }>(`${base}/comments`)).comments,
    addComment: async (input) => (await send<{ comment: TeamComment }>("/comments", "POST", input)).comment,
    resolveComment: async (id, resolved) =>
      (await send<{ comment: TeamComment }>(`/comments/${id}`, "PATCH", { resolved })).comment,
    deleteComment: async (id) => void (await send(`/comments/${id}`, "DELETE")),
    notes: async () => (await teamRequest<{ notes: WhiteboardNote[] }>(`${base}/whiteboard`)).notes,
    changeNote: async (op) => void (await send("/whiteboard", "POST", op)),
    chats: async () => (await teamRequest<{ chats: TeamChat[] }>(`${base}/chats`)).chats,
    createChat: async (input) => (await send<{ chat: TeamChat }>("/chats", "POST", input)).chat,
    messages: async (chatId) =>
      (await teamRequest<{ messages: ChatMessage[] }>(`${base}/chats/${chatId}/messages`)).messages,
    post: async (chatId, body) =>
      (await send<{ message: ChatMessage }>(`/chats/${chatId}/messages`, "POST", { body })).message,
  };
}

interface DemoSpace {
  comments: TeamComment[];
  notes: WhiteboardNote[];
  chats: TeamChat[];
  messages: ChatMessage[];
}

function demoBackend(projectId: string, me: TeamPerson): TeamBackend {
  const key = `fundur.team.demo.${projectId}`;
  const read = (): DemoSpace => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as DemoSpace;
    } catch {
      /* A blocked or broken copy starts empty. */
    }
    return { comments: [], notes: [], chats: [], messages: [] };
  };
  const write = (space: DemoSpace) => {
    try {
      localStorage.setItem(key, JSON.stringify(space));
    } catch {
      throw new Error("This browser could not keep the change. Free some space and retry.");
    }
  };
  const now = () => new Date().toISOString();
  return {
    comments: async () => read().comments,
    addComment: async (input) => {
      const space = read();
      const comment: TeamComment = {
        id: crypto.randomUUID(),
        anchor: input.anchor,
        parentId: input.parentId ?? null,
        authorId: me.id,
        authorName: me.name,
        body: input.body.trim(),
        createdAt: now(),
        resolvedAt: null,
      };
      write({ ...space, comments: [...space.comments, comment] });
      return comment;
    },
    resolveComment: async (id, resolved) => {
      const space = read();
      const comments = space.comments.map((c) => (c.id === id ? { ...c, resolvedAt: resolved ? now() : null } : c));
      write({ ...space, comments });
      const found = comments.find((c) => c.id === id);
      if (!found) throw new Error("Comment not found");
      return found;
    },
    deleteComment: async (id) => {
      const space = read();
      write({ ...space, comments: space.comments.filter((c) => c.id !== id && c.parentId !== id) });
    },
    notes: async () => read().notes,
    changeNote: async (op) => {
      const space = read();
      const notes =
        op.type === "remove"
          ? space.notes.filter((n) => n.id !== op.id)
          : [...space.notes.filter((n) => n.id !== op.note.id), { ...op.note, updatedAt: now(), updatedBy: me.name }];
      write({ ...space, notes });
    },
    chats: async () => {
      const space = read();
      if (space.chats.some((c) => !c.memberIds.length)) return space.chats;
      const everyone: TeamChat = { id: EVERYONE_CHAT, name: "Everyone", memberIds: [], createdBy: me.id, createdAt: now(), lastMessageAt: null };
      write({ ...space, chats: [everyone, ...space.chats] });
      return [everyone, ...space.chats];
    },
    createChat: async () => {
      throw new Error("Group chats need teammates, who join once you sign in.");
    },
    messages: async (chatId) => read().messages.filter((m) => m.chatId === chatId),
    post: async (chatId, body) => {
      const space = read();
      const message: ChatMessage = { id: crypto.randomUUID(), chatId, authorId: me.id, authorName: me.name, body: body.trim(), createdAt: now() };
      write({
        ...space,
        messages: [...space.messages, message].slice(-2000),
        chats: space.chats.map((c) => (c.id === chatId ? { ...c, lastMessageAt: message.createdAt } : c)),
      });
      return message;
    },
  };
}

export function teamBackend(projectId: string, server: boolean, me: TeamPerson): TeamBackend {
  return server ? serverBackend(projectId) : demoBackend(projectId, me);
}

// Owner screens: who is on the project, and the client's page.

export interface TeamAccessRow extends TeamMember {
  active: boolean;
  access: ProjectAccess | null;
}

export async function loadTeam(projectId: string): Promise<TeamAccessRow[]> {
  return (await teamRequest<{ members: TeamAccessRow[] }>(`/api/projects/${encodeURIComponent(projectId)}/team`)).members;
}
export async function saveAccess(projectId: string, userId: string, access: ProjectAccess | null): Promise<void> {
  await teamRequest(`/api/projects/${encodeURIComponent(projectId)}/team`, {
    method: "PUT",
    body: JSON.stringify({ userId, access }),
  });
}
export async function loadClientInvites(projectId: string): Promise<ClientInvite[]> {
  return (await teamRequest<{ invites: ClientInvite[] }>(`/api/projects/${encodeURIComponent(projectId)}/client-invites`)).invites;
}
export async function inviteClient(
  projectId: string,
  email: string,
  settings: ClientViewSettings,
): Promise<{ invite: ClientInvite; url: string }> {
  return teamRequest(`/api/projects/${encodeURIComponent(projectId)}/client-invites`, {
    method: "POST",
    body: JSON.stringify({ email, settings }),
  });
}
export async function changeClientInvite(
  projectId: string,
  inviteId: string,
  change: { settings?: ClientViewSettings; revoke?: boolean },
): Promise<ClientInvite> {
  return (
    await teamRequest<{ invite: ClientInvite }>(
      `/api/projects/${encodeURIComponent(projectId)}/client-invites/${inviteId}`,
      { method: "PATCH", body: JSON.stringify(change) },
    )
  ).invite;
}
