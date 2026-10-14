import { after } from "next/server";
import { z } from "zod";
import { openFile } from "@/lib/storage/blob";
import { projectTeam } from "@/lib/team/store";
import type { FeatureState } from "@/lib/workspaces/store";
import { answerInThread } from "./assistant-reply";
import { joinInfo } from "./calls";
import { checkedAttachments, commsFailure, commsJson, fileResponse, readBody } from "./http";
import { takeNotes } from "./notes";
import {
  addCaptions,
  addPost,
  attachmentFile,
  deletePost,
  editPost,
  reactToPost,
  pinPost,
  listPinned,
  searchPosts,
  endMeeting,
  getMeeting,
  getThread,
  getTranscript,
  joinRoom,
  leaveRoom,
  listChannels,
  listMeetings,
  listPosts,
  listRecordings,
  markRead,
  channelFiles,
  answerAsk,
  lastRead,
  nextInSeries,
  rollSeries,
  hostAction,
  channelPresence,
  setChannelMine,
  pollRoom,
  sendSignals,
  setConsent,
  setRecording,
  type CommsScope,
} from "./store";
import { ASSISTANT_KEY, ASSISTANT_NAME, channelMineSchema, newPostSchema, postChangeSchema, roomActionSchema } from "./types";

/**
 * The request handlers teammates and invited clients share. The routes only
 * work out who is asking (a scope) and pass it here, so a client can never
 * reach more than the scope lets them.
 */

const uuid = z.uuid();
const notFound = (what: string) => commsJson({ error: `${what} not found` }, 404);

export async function channelsResponse(s: CommsScope) {
  try {
    const channels = await listChannels(s);
    // Clients see the studio's team by name only, to know who they are talking to.
    const team = (await projectTeam(s.db, s.workspaceId, s.slug)).filter((m) => m.active).map((m) => ({ key: m.id, name: m.name }));
    const people = s.person.kind === "team" ? [...team, { key: ASSISTANT_KEY, name: ASSISTANT_NAME }] : team;
    return commsJson({ channels, people, me: s.person, canManage: s.manager });
  } catch (e) {
    return commsFailure(e);
  }
}

export async function postsResponse(s: CommsScope, channelId: string, url: URL) {
  if (!uuid.safeParse(channelId).success) return notFound("Channel");
  try {
    const before = url.searchParams.get("before");
    const posts = await listPosts(s, channelId, { before: before && !Number.isNaN(Date.parse(before)) ? before : undefined });
    if (before) return commsJson({ posts });
    // Where this person had read up to, for the "New" line, before this visit counts as reading.
    const readBefore = await lastRead(s, channelId);
    await markRead(s, channelId);
    return commsJson({ posts, pinned: await listPinned(s, channelId), presence: await channelPresence(s, channelId), readBefore });
  } catch (e) {
    return commsFailure(e);
  }
}

/** Adds a post. "@Assistant" from a teammate gets an answer in the thread once this response is sent. */
export async function addPostResponse(s: CommsScope, channelId: string, req: Request, extra: { isAdmin?: boolean; features?: FeatureState } = {}) {
  if (!uuid.safeParse(channelId).success) return notFound("Channel");
  const input = newPostSchema.safeParse(await readBody(req));
  if (!input.success) return commsJson({ error: "Write a message or add a file" }, 400);
  try {
    const attachments = await checkedAttachments(s, input.data.attachments);
    const post = await addPost(s, channelId, { ...input.data, attachments });
    const askedAssistant = s.person.kind === "team" && post.mentions.includes(ASSISTANT_KEY) && extra.features?.ai !== false;
    if (askedAssistant)
      after(() =>
        answerInThread(s, post, { isAdmin: !!extra.isAdmin, features: extra.features }).catch((err) =>
          console.error("Assistant reply failed", err instanceof Error ? err.message : "unknown"),
        ),
      );
    return commsJson({ post, assistantAnswering: askedAssistant }, 201);
  } catch (e) {
    return commsFailure(e);
  }
}

export async function channelFilesResponse(s: CommsScope, channelId: string) {
  if (!uuid.safeParse(channelId).success) return notFound("Channel");
  try {
    return commsJson({ posts: await channelFiles(s, channelId) });
  } catch (e) {
    return commsFailure(e);
  }
}

/** "I am typing" (sent every few seconds while someone writes), or muting a channel for oneself. */
export async function channelMineResponse(s: CommsScope, channelId: string, req: Request) {
  const input = channelMineSchema.safeParse(await readBody(req));
  if (!input.success || !uuid.safeParse(channelId).success) return commsJson({ error: "Say typing or muted" }, 400);
  try {
    await setChannelMine(s, channelId, input.data);
    return commsJson({ ok: true });
  } catch (e) {
    return commsFailure(e);
  }
}

export async function searchResponse(s: CommsScope, url: URL) {
  const q = (url.searchParams.get("q") ?? "").slice(0, 200);
  try {
    return commsJson({ results: await searchPosts(s, q) });
  } catch (e) {
    return commsFailure(e);
  }
}

export async function threadResponse(s: CommsScope, postId: string) {
  if (!uuid.safeParse(postId).success) return notFound("Post");
  try {
    return commsJson(await getThread(s, postId));
  } catch (e) {
    return commsFailure(e);
  }
}

export async function editPostResponse(s: CommsScope, postId: string, req: Request) {
  const input = postChangeSchema.safeParse(await readBody(req));
  if (!input.success || !uuid.safeParse(postId).success) return commsJson({ error: "Write the new text" }, 400);
  try {
    const change = input.data;
    const post =
      "react" in change
        ? await reactToPost(s, postId, change.react, change.on)
        : "pin" in change
          ? await pinPost(s, postId, change.pin)
          : "answer" in change
            ? await answerAsk(s, postId, change.answer)
            : await editPost(s, postId, change.body);
    return commsJson({ post });
  } catch (e) {
    return commsFailure(e);
  }
}

export async function deletePostResponse(s: CommsScope, postId: string) {
  if (!uuid.safeParse(postId).success) return notFound("Post");
  try {
    await deletePost(s, postId);
    return commsJson({ ok: true });
  } catch (e) {
    return commsFailure(e);
  }
}

export async function attachmentResponse(s: CommsScope, postId: string, fileId: string, url: URL) {
  if (!uuid.safeParse(postId).success || !uuid.safeParse(fileId).success) return notFound("File");
  try {
    const file = await attachmentFile(s, postId, fileId);
    const stored = file && (await openFile(file.storageKey));
    if (!file || !stored) return notFound("File");
    return fileResponse(stored, file.name, file.contentType, url.searchParams.get("view") === "1");
  } catch (e) {
    return commsFailure(e);
  }
}

export async function meetingsResponse(s: CommsScope, url: URL) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const ok = (v: string | null) => (v && !Number.isNaN(Date.parse(v)) ? v : undefined);
  try {
    return commsJson({ meetings: await listMeetings(s, { from: ok(from), to: ok(to) }) });
  } catch (e) {
    return commsFailure(e);
  }
}

export async function meetingResponse(s: CommsScope, meetingId: string) {
  if (!uuid.safeParse(meetingId).success) return notFound("Meeting");
  try {
    const meeting = await getMeeting(s, meetingId);
    // Clients join the call and its chat; the transcript, notes and recordings stay with the studio, which decides what to share.
    if (meeting.seriesId) await rollSeries(s.db, s.workspaceId, s.projectId);
    const next = await nextInSeries(s, meeting);
    if (s.person.kind !== "team") return commsJson({ meeting: { ...meeting, notes: null, notesSource: null }, transcript: [], recordings: [], next });
    return commsJson({ meeting, transcript: await getTranscript(s, meetingId), recordings: await listRecordings(s, meetingId), next });
  } catch (e) {
    return commsFailure(e);
  }
}

/** Notes are taken in the organiser's name, as they made the meeting. */
function notesAfterCall(s: CommsScope, meetingId: string, organiser: string) {
  after(async () => {
    try {
      await takeNotes({ ...s, person: { key: organiser, name: "Meeting notes", kind: "team" } }, meetingId);
    } catch (err) {
      console.error("Meeting notes failed", err instanceof Error ? err.message : "unknown");
    }
  });
}

/** Everything a browser does in a call: join, keep in touch, hand over handshakes, record, agree, caption, leave, end. */
export async function roomResponse(s: CommsScope, meetingId: string, req: Request) {
  if (!uuid.safeParse(meetingId).success) return notFound("Meeting");
  const parsed = roomActionSchema.safeParse(await readBody(req));
  if (!parsed.success) return commsJson({ error: "That did not reach the call. Retrying." }, 400);
  const a = parsed.data;
  try {
    switch (a.action) {
      case "join": {
        const { meeting, peer } = await joinRoom(s, meetingId, a.peerId, a.state);
        // Someone waiting gets no way into the call (a LiveKit token) until they are let in.
        if (!peer.admitted) return commsJson({ meeting, peer, join: null });
        const [row] = await s.db.query<{ room: string }>("SELECT room FROM meetings WHERE id=$1", [meetingId]);
        return commsJson({ meeting, peer, join: await joinInfo(s.db, { room: row.room, provider: meeting.provider }, peer) });
      }
      case "poll":
        return commsJson(await pollRoom(s, meetingId, a.peerId, { state: a.state, afterSignal: a.afterSignal, afterLine: a.afterLine }));
      case "signal":
        await sendSignals(s, meetingId, a.peerId, a.to, a.payloads);
        return commsJson({ ok: true });
      case "record":
        return commsJson({ meeting: await setRecording(s, meetingId, a.peerId, a.on, a.captions ?? true) });
      case "host":
        await hostAction(s, meetingId, a.peerId, a.what, a.target);
        return commsJson({ ok: true });
      case "consent":
        await setConsent(s, meetingId, a.decision);
        return commsJson({ ok: true });
      case "caption":
        await addCaptions(s, meetingId, a.peerId, a.lines);
        return commsJson({ ok: true });
      case "leave":
      case "end": {
        const meeting = await getMeeting(s, meetingId);
        const ended = a.action === "end" ? await endMeeting(s, meetingId) : await leaveRoom(s, meetingId, a.peerId);
        if (ended && meeting.hasTranscript) notesAfterCall(s, meetingId, meeting.createdBy);
        return commsJson({ ended });
      }
    }
  } catch (e) {
    return commsFailure(e);
  }
}
