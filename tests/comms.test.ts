import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../src/lib/db/migrator";
import type { Db } from "../src/lib/db";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { createProject, getProject, projectDbId } from "../src/lib/projects/store";
import { listChats, listMessages, postMessage } from "../src/lib/team/store";
import {
  addCaptions,
  addPost,
  attachmentFile,
  createChannel,
  createMeeting,
  deletePost,
  editPost,
  endMeeting,
  getMeeting,
  getThread,
  getTranscript,
  joinRoom,
  leaveRoom,
  listChannels,
  listConsents,
  listMeetings,
  listNotifications,
  listPosts,
  markNotificationsRead,
  markRead,
  hostAction,
  channelPresence,
  setChannelMine,
  reactToPost,
  pinPost,
  listPinned,
  searchPosts,
  meetingsBetween,
  pollRoom,
  recentActivity,
  sendSignals,
  setConsent,
  setRecording,
  updateChannel,
  updateMeeting,
  uploadTranscript,
  type CommsScope,
} from "../src/lib/comms/store";
import { actionItemsToTasks, takeNotes } from "../src/lib/comms/notes";
import { liveKitToken } from "../src/lib/comms/calls";
import {
  clientKey,
  findMentions,
  joinable,
  newPostSchema,
  parseTranscript,
  quickNotes,
  roomActionSchema,
  transcriptText,
} from "../src/lib/comms/types";
import { takeBackup, restoreBackup, checkRestore } from "../src/lib/backup/backup";
import { AccessError } from "../src/lib/workspaces/store";
import { getTool } from "../src/lib/ai/tools";
import { MODULE_REGISTRY } from "../src/lib/modules/registry";

async function fresh() {
  const pg = new PGlite();
  await runMigrations({ exec: (s) => pg.exec(s), query: (s, p) => pg.query(s, p) });
  const db: Db = { query: async (s, p) => (await pg.query(s, p)).rows as never };
  return { db, pg };
}

async function setup(db: Db) {
  const ws = await ensureWorkspace(db, { sub: "owner", email: "owner@example.com", name: "Olive Owner" });
  await createProject(db, ws, {
    id: "office",
    name: "Office",
    client: "Client",
    workflowId: "interior-design-corporate",
    startDate: "2026-10-01T00:00:00.000Z",
    swatch: "sage",
  });
  for (const [id, name] of [["mem", "Mia Member"], ["ann", "Ann"], ["annlee", "Ann Lee"]] as const) {
    await db.query("INSERT INTO users(id,email,name) VALUES($1,$2,$3)", [id, `${id}@example.com`, name]);
    await db.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'member')", [ws, id]);
  }
  const projectId = (await projectDbId(db, ws, "office"))!;
  const scope = (key: string, name: string, manager = false): CommsScope => ({ db, workspaceId: ws, projectId, slug: "office", person: { key, name, kind: "team" }, manager });
  return {
    ws,
    projectId,
    owner: scope("owner", "Olive Owner", true),
    mem: scope("mem", "Mia Member"),
    client: { db, workspaceId: ws, projectId, slug: "office", person: { key: clientKey("Cleo@Client.com"), name: "Cleo", kind: "client" as const }, manager: false },
  };
}

const refused = (status: number) => (e: unknown) => e instanceof AccessError && e.status === status;

test("mentions: longest name wins, emails are not mentions, assistant and everyone", () => {
  const people = [
    { key: "ann", name: "Ann" },
    { key: "annlee", name: "Ann Lee" },
    { key: "mem", name: "Mia Member" },
  ];
  assert.deepEqual(findMentions("@Ann Lee can you check?", people), ["annlee"]);
  assert.deepEqual(findMentions("Thanks @ann, and @Mia Member.", people).sort(), ["ann", "mem"]);
  assert.deepEqual(findMentions("mail ann@ann.com", people), []);
  assert.deepEqual(findMentions("@Annette hi", people), []);
  assert.deepEqual(findMentions("@assistant summarise this, @everyone", people).sort(), ["assistant", "everyone"]);
  assert.equal(newPostSchema.safeParse({ body: "  " }).success, false);
  assert.equal(newPostSchema.safeParse({ body: "", attachments: [{ storageKey: "k", name: "a.pdf", sizeBytes: 1 }] }).success, true);
});

test("transcripts: Teams/Zoom WebVTT voices, SRT, and plain 'Name: words' text", () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
<v Thandi Mokoena>We agreed on the oak floor.</v>

00:00:03.500 --> 00:00:05.000
<v Thandi Mokoena>Pieter will send the quote by Friday.</v>

00:01:10.000 --> 00:01:12.000
<v Pieter>Sure.</v>
`;
  const lines = parseTranscript(vtt);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { speaker: "Thandi Mokoena", atMs: 1000, text: "We agreed on the oak floor. Pieter will send the quote by Friday." });
  assert.equal(lines[1].atMs, 70_000);

  const srt = "1\r\n00:00:02,500 --> 00:00:04,000\r\nAnn: Hello there\r\n\r\n2\r\n00:00:05,000 --> 00:00:06,000\r\nshall we start\r\n";
  assert.deepEqual(parseTranscript(srt), [{ speaker: "Ann", atMs: 2500, text: "Hello there shall we start" }]);

  const plain = "[00:05] Ann: Morning all\nBob: Hi\n01:02:03 Ann: Last thing";
  const p = parseTranscript(plain);
  assert.deepEqual(p.map((l) => [l.speaker, l.atMs]), [["Ann", 5000], ["Bob", 5000], ["Ann", 3_723_000]]);
  assert.equal(transcriptText([{ speaker: "Ann", atMs: 3_723_000, text: "x" }]), "[1:02:03] Ann: x");
});

test("quick notes pick decisions and action items with owners and dates out of what was said", () => {
  const notes = quickNotes(
    [
      { speaker: "Thandi", text: "We agreed on the oak floor for the boardroom." },
      { speaker: "Thandi", text: "Pieter will send the revised quote by Friday." },
      { speaker: "Pieter", text: "I'll book the site visit tomorrow. Action: check the ceiling height." },
      { speaker: "Ann", text: "Will you call me?" },
    ],
    new Date(2026, 9, 13), // a Tuesday
  );
  assert.equal(notes.decisions.length, 1);
  assert.match(notes.decisions[0], /oak floor/);
  const titles = notes.actionItems.map((a) => [a.title, a.owner, a.due]);
  assert.deepEqual(titles, [
    ["Send the revised quote by Friday", "Pieter", "2026-10-16"],
    ["Book the site visit tomorrow", "Pieter", "2026-10-14"],
    ["Check the ceiling height", undefined, undefined],
  ]);
  assert.match(notes.summary, /3 people spoke/);
});

test("LiveKit tokens are HS256 JWTs for one room and person", () => {
  const token = liveKitToken({ apiKey: "APIkey", secret: "s3cret-s3cret" }, { room: "r1", identity: "peer-1", name: "Ann" }, Date.UTC(2026, 0, 1));
  const [h, p, sig] = token.split(".");
  assert.equal(createHmac("sha256", "s3cret-s3cret").update(`${h}.${p}`).digest("base64url"), sig);
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(payload.iss, "APIkey");
  assert.equal(payload.sub, "peer-1");
  assert.deepEqual(payload.video, { room: "r1", roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  assert.equal(payload.exp - payload.iat, 6 * 3600);
});

test("a meeting can be joined from 15 minutes before until two hours after its end", () => {
  const m = { status: "scheduled" as const, startsAt: "2026-10-13T10:00:00Z", durationMin: 30 };
  assert.equal(joinable(m, Date.parse("2026-10-13T09:40:00Z")), false);
  assert.equal(joinable(m, Date.parse("2026-10-13T09:50:00Z")), true);
  assert.equal(joinable(m, Date.parse("2026-10-13T12:31:00Z")), false);
  assert.equal(joinable({ ...m, status: "cancelled" }, Date.parse("2026-10-13T10:00:00Z")), false);
  assert.equal(roomActionSchema.safeParse({ action: "consent", decision: "maybe" }).success, false);
});

test("channels: default, private and client channels, unread counts, threads, mentions and notifications", async () => {
  const { db, pg } = await fresh();
  try {
    const { owner, mem, client, ws } = await setup(db);
    const [everyone] = await listChannels(owner);
    assert.equal(everyone.name, "Everyone");
    assert.equal(everyone.isDefault, true);
    // The team space's chat list is the same "Everyone" channel.
    assert.equal((await listChats(db, ws, "office", "owner"))[0].id, everyone.id);

    const priv = await createChannel(owner, { name: "Lighting", memberIds: ["ann"] });
    const shared = await createChannel(owner, { name: "Client", visibility: "client" });
    assert.deepEqual((await listChannels(mem)).map((c) => c.name), ["Everyone", "Client"]);
    assert.deepEqual((await listChannels(client)).map((c) => c.name), ["Client"]);
    await assert.rejects(listPosts(client, everyone.id), refused(404));
    await assert.rejects(listPosts(mem, priv.id), refused(404));
    await assert.rejects(createChannel(client, { name: "Mine" }), refused(403));
    await assert.rejects(createChannel(owner, { name: "Mixed", visibility: "client", memberIds: ["mem"] }), refused(400));

    const post = await addPost(owner, everyone.id, { body: "@Mia Member can you check the lights? cc @Ann Lee" });
    assert.deepEqual(post.mentions.sort(), ["annlee", "mem"]);
    assert.equal((await listChannels(mem))[0].unread, 1);
    assert.equal((await listChannels(owner))[0].unread, 0);
    await markRead(mem, everyone.id);
    assert.equal((await listChannels(mem))[0].unread, 0);

    const reply = await addPost(mem, everyone.id, { body: "On it", parentId: post.id });
    const { post: root, replies } = await getThread(mem, reply.id);
    assert.equal(root.replyCount, 1);
    assert.deepEqual(replies.map((r) => r.body), ["On it"]);
    // Replies stay out of the channel's list of threads, and out of the team space chat.
    assert.deepEqual((await listPosts(owner, everyone.id)).map((p) => p.id), [post.id]);
    assert.equal((await listMessages(db, ws, "office", everyone.id, "owner")).length, 1);
    await postMessage(db, ws, "office", everyone.id, { id: "owner", name: "Olive Owner" }, "From the team space");
    assert.equal((await listPosts(owner, everyone.id)).length, 2);

    const memNotes = await listNotifications(db, ws, "mem");
    assert.equal(memNotes.unread, 1);
    assert.match(memNotes.notifications[0].title, /mentioned you in #Everyone/);
    assert.equal(memNotes.notifications[0].href, `/projects/office/conversations?channel=${everyone.id}&post=${post.id}`);
    const ownerNotes = await listNotifications(db, ws, "owner");
    assert.match(ownerNotes.notifications[0].title, /Mia Member replied/);
    await markNotificationsRead(db, ws, "mem");
    assert.equal((await listNotifications(db, ws, "mem")).unread, 0);

    // A client's post reaches the whole team; files keep where they are stored to the server.
    const fromClient = await addPost(client, shared.id, { body: "Here is our logo", attachments: [{ storageKey: "ws/p/logo.png", name: "logo.png", sizeBytes: 10, contentType: "image/png" }] });
    assert.equal(fromClient.authorKind, "client");
    assert.equal("storageKey" in fromClient.attachments[0], false);
    assert.equal((await attachmentFile(owner, fromClient.id, fromClient.attachments[0].id))?.storageKey, "ws/p/logo.png");
    assert.match((await listNotifications(db, ws, "mem")).notifications[0].title, /Cleo posted in #Client/);
    // A client can't mention the assistant into spending.
    assert.deepEqual((await addPost(client, shared.id, { body: "@assistant do it" })).mentions, []);

    // Reactions: one per person per emoji, taken back, and only where the post can be seen.
    await reactToPost(mem, post.id, "👍", true);
    await reactToPost(mem, post.id, "👍", true);
    const liked = await reactToPost(owner, post.id, "👍", true);
    assert.deepEqual(liked.reactions.map((r) => [r.emoji, r.people.length]), [["👍", 2]]);
    assert.deepEqual((await reactToPost(mem, post.id, "👍", false)).reactions[0].people.map((p) => p.key), [liked.reactions[0].people[1].key]);
    assert.equal((await reactToPost(owner, post.id, "👍", false)).reactions.length, 0);
    await assert.rejects(reactToPost(client, post.id, "🎉", true));
    assert.equal((await reactToPost(client, fromClient.id, "🎉", true)).reactions[0].people[0].name.length > 0, true);

    // Pins: the studio pins, clients can't; search finds words in posts, names and file names, only where the person can see.
    assert.ok((await pinPost(owner, post.id, true)).pinnedAt);
    await assert.rejects(pinPost(client, fromClient.id, true), refused(403));
    assert.deepEqual((await listPinned(mem, everyone.id)).map((p) => p.id), [post.id]);
    assert.equal((await pinPost(owner, post.id, false)).pinnedAt, null);
    assert.equal((await searchPosts(owner, "lights check")).some((p) => p.id === post.id), true);
    assert.equal((await searchPosts(owner, "logo.png")).some((p) => p.id === fromClient.id), true);
    assert.equal((await searchPosts(client, "lights")).length, 0);
    assert.equal((await searchPosts(owner, "100%")).length, 0);

    // Seen by, typing, and muting: a muted channel only tells you when you are named.
    assert.deepEqual((await channelPresence(owner, everyone.id)).seen.map((p) => p.name), ["Mia Member"]);
    await setChannelMine(mem, everyone.id, { typing: true });
    assert.deepEqual((await channelPresence(owner, everyone.id)).typing.map((p) => p.name), ["Mia Member"]);
    assert.equal((await channelPresence(mem, everyone.id)).typing.length, 0);
    await setChannelMine(mem, everyone.id, { muted: true });
    assert.equal((await listChannels(mem))[0].muted, true);
    assert.equal((await listChannels(owner))[0].muted, false);
    await markNotificationsRead(db, ws, "mem");
    await addPost(owner, everyone.id, { body: "Thanks", parentId: post.id });
    assert.equal((await listNotifications(db, ws, "mem")).unread, 0);
    await addPost(owner, everyone.id, { body: "@Mia Member one more", parentId: post.id });
    assert.equal((await listNotifications(db, ws, "mem")).unread, 1);
    await setChannelMine(mem, everyone.id, { muted: false });
    assert.equal((await listChannels(mem))[0].muted, false);
    await assert.rejects(setChannelMine(client, everyone.id, { typing: true }), refused(404));

    await assert.rejects(editPost(mem, post.id, "changed"), refused(403));
    assert.equal((await editPost(owner, post.id, "Changed @Ann")).mentions[0], "ann");
    await assert.rejects(deletePost(mem, post.id), refused(403));
    await deletePost(owner, reply.id);
    assert.equal((await getThread(owner, post.id)).post.replyCount, 2);

    await assert.rejects(updateChannel(owner, everyone.id, { archived: true }), refused(400));
    await updateChannel(owner, priv.id, { archived: true });
    assert.equal((await listChannels(owner)).some((c) => c.id === priv.id), false);
    assert.equal((await listChannels(owner, { archived: true }))[0].id, priv.id);
    assert.equal((await recentActivity(owner, { query: "logo" })).length, 1);
  } finally {
    await pg.close();
  }
});

test("meetings: scheduling, the call room, recording consent, captions, transcripts, notes and tasks", async () => {
  const { db, pg } = await fresh();
  try {
    const { owner, mem, client, ws } = await setup(db);
    const teamOnly = await createMeeting(owner, { title: "Design review", startsAt: "2026-10-14T08:00:00Z", durationMin: 45 }, "builtin");
    assert.equal(teamOnly.status, "scheduled");
    const thread = await getThread(owner, teamOnly.postId!);
    assert.equal(thread.post.meetingId, teamOnly.id);
    assert.equal(thread.post.authorKind, "system");
    assert.match((await listNotifications(db, ws, "mem")).notifications[0].title, /scheduled Design review/);

    const withClient = await createMeeting(owner, { title: "Client walk-through", startsAt: "2026-10-15T08:00:00Z", clientVisible: true }, "builtin");
    const clientChannel = (await listChannels(owner)).find((c) => c.id === withClient.channelId)!;
    assert.equal(clientChannel.visibility, "client");
    assert.deepEqual((await listMeetings(client)).map((m) => m.title), ["Client walk-through"]);
    await assert.rejects(getMeeting(client, teamOnly.id), refused(404));
    await assert.rejects(updateMeeting(owner, teamOnly.id, { clientVisible: true }), refused(400));
    assert.equal((await meetingsBetween(db, ws, ["office"], "2026-10-14T00:00:00Z", "2026-10-15T00:00:00Z")).length, 1);

    // Two browsers in the call pass their handshakes through the server.
    const a = "00000000-0000-4000-8000-00000000000a";
    const b = "00000000-0000-4000-8000-00000000000b";
    const c = "00000000-0000-4000-8000-00000000000c";
    const quiet = { mic: true, cam: true, screen: false, hand: false };
    await joinRoom(owner, withClient.id, a, quiet);
    // The client waits in the lobby, hearing nothing of the call, until the studio lets them in.
    assert.equal((await joinRoom(client, withClient.id, b, quiet)).peer.admitted, false);
    const lobby = await pollRoom(client, withClient.id, b, { afterSignal: 0, afterLine: 0 });
    assert.deepEqual([lobby.peers.length, lobby.you?.admitted], [0, false]);
    assert.deepEqual((await pollRoom(owner, withClient.id, a, { afterSignal: 0, afterLine: 0 })).waiting?.map((w) => w.name), ["Cleo"]);
    await assert.rejects(sendSignals(client, withClient.id, b, a, [{ kind: "hello" }]), refused(409));
    await assert.rejects(hostAction(client, withClient.id, b, "admit", b), refused(403));
    await hostAction(owner, withClient.id, a, "admit", b);
    assert.equal((await pollRoom(client, withClient.id, b, { afterSignal: 0, afterLine: 0 })).you?.admitted, true);
    await assert.rejects(joinRoom(mem, withClient.id, a, quiet), refused(409));
    assert.equal((await getMeeting(owner, withClient.id)).status, "live");
    await sendSignals(owner, withClient.id, a, b, [{ kind: "hello" }, { kind: "description", description: { type: "offer", sdp: "v=0" } }]);
    let snap = await pollRoom(client, withClient.id, b, { afterSignal: 0, afterLine: 0 });
    assert.deepEqual(snap.peers.map((p) => p.name), ["Olive Owner", "Cleo"]);
    assert.deepEqual(snap.signals.map((s) => s.payload.kind), ["hello", "description"]);
    snap = await pollRoom(client, withClient.id, b, { afterSignal: snap.signals[1].id, afterLine: 0 });
    assert.equal(snap.signals.length, 0);
    await assert.rejects(pollRoom(client, withClient.id, a, { afterSignal: 0, afterLine: 0 }), refused(409));

    // Recording asks everyone; captions only come from people who agreed.
    await assert.rejects(setRecording(client, withClient.id, b, true), refused(403));
    await setRecording(owner, withClient.id, a, true, true);
    assert.deepEqual((await listConsents(db, withClient.id)).map((x) => [x.name, x.decision]), [["Olive Owner", "given"]]);
    await assert.rejects(addCaptions(client, withClient.id, b, [{ atMs: 1000, text: "Hello" }]), refused(409));
    await setConsent(client, withClient.id, "given");
    await addCaptions(owner, withClient.id, a, [{ atMs: 500, text: "We agreed on the oak floor." }]);
    await addCaptions(client, withClient.id, b, [{ atMs: 2000, text: "Thandi will send the samples tomorrow." }]);
    snap = await pollRoom(owner, withClient.id, a, { afterSignal: 0, afterLine: 0 });
    assert.deepEqual(snap.lines.map((l) => l.speaker), ["Olive Owner", "Cleo"]);
    assert.equal(snap.meeting.recording, "on");

    // The studio mutes someone (they see when), or takes them out; they can't come back on that link.
    await hostAction(owner, withClient.id, a, "mute", b);
    assert.ok((await pollRoom(client, withClient.id, b, { afterSignal: 0, afterLine: 0 })).you?.mutedAt);
    await assert.rejects(hostAction(owner, withClient.id, a, "remove", a), refused(400));
    await hostAction(owner, withClient.id, a, "remove", b);
    await assert.rejects(pollRoom(client, withClient.id, b, { afterSignal: 0, afterLine: 0 }), refused(403));
    await assert.rejects(joinRoom(client, withClient.id, b, quiet), refused(403));

    await leaveRoom(client, withClient.id, b);
    assert.equal(await leaveRoom(owner, withClient.id, a), true);
    const ended = await getMeeting(owner, withClient.id);
    assert.equal(ended.status, "ended");
    assert.equal(ended.recording, "off");
    assert.equal(ended.hasTranscript, true);
    await assert.rejects(endMeeting(client, withClient.id), refused(403));

    // No model is set up in the test database, so the quick notes are taken.
    const noted = await takeNotes(owner, withClient.id);
    assert.equal(noted?.source, "quick");
    assert.equal(noted?.meeting.notes?.decisions.length, 1);
    assert.equal(noted?.meeting.notes?.actionItems[0].owner, "Thandi");
    const replies = (await getThread(owner, withClient.postId!)).replies.map((r) => r.body);
    assert.ok(replies.some((r) => r.startsWith("Quick meeting notes are ready")));
    assert.ok(replies.some((r) => r.startsWith("The call ended")));

    // An uploaded transcript wins over live captions.
    await uploadTranscript(owner, withClient.id, parseTranscript("Ann: First\nBob: Second"));
    assert.deepEqual((await getTranscript(owner, withClient.id)).map((l) => l.speaker), ["Ann", "Bob"]);
    await assert.rejects(uploadTranscript(client, withClient.id, []), refused(403));

    const { created } = await actionItemsToTasks(owner, withClient.id);
    assert.equal(Object.keys(created).length, 1);
    const project = (await getProject(db, ws, "office"))!;
    const task = project.tasks.find((t) => t.id === Object.values(created)[0]);
    assert.equal(task?.title, "Thandi: Send the samples tomorrow");
    assert.equal((await actionItemsToTasks(owner, withClient.id)).created && Object.keys((await actionItemsToTasks(owner, withClient.id)).created).length, 0);
    // Notes written by hand are kept when notes are taken again.
    await updateMeeting(owner, withClient.id, { notes: { summary: "Mine", decisions: [], actionItems: [] } });
    assert.equal(await takeNotes(owner, withClient.id), null);

    const cancelled = await updateMeeting(owner, teamOnly.id, { status: "cancelled" });
    assert.equal(cancelled.status, "cancelled");
    await assert.rejects(joinRoom(owner, teamOnly.id, c, quiet), refused(400));

    // Everything comes back from a backup.
    const backup = await takeBackup(db);
    assert.ok(backup.counts.meetings === 2 && backup.counts.meeting_transcript_lines > 0 && backup.counts.notifications > 0);
    const target = await fresh();
    try {
      await restoreBackup(target.db, backup);
      assert.deepEqual(await checkRestore(target.db, backup), []);
      const [row] = await target.db.query<{ attachments: unknown; notes: unknown }>("SELECT (SELECT attachments FROM project_chat_messages LIMIT 1) AS attachments, (SELECT notes FROM meetings WHERE notes IS NOT NULL LIMIT 1) AS notes");
      assert.ok(Array.isArray(row.attachments));
      assert.equal((row.notes as { summary: string }).summary, "Mine");
      await target.db.query("INSERT INTO meeting_transcript_lines(meeting_id,speaker,text,source) VALUES($1,'x','y','live')", [withClient.id]);
    } finally {
      await target.pg.close();
    }
  } finally {
    await pg.close();
  }
});

test("the assistant can read and act on conversations and meetings", () => {
  for (const name of ["read_conversations", "read_conversation_thread", "post_in_conversation", "list_meetings", "read_meeting", "schedule_meeting", "cancel_meeting", "take_meeting_notes", "meeting_actions_to_tasks"]) {
    const tool = getTool(name);
    assert.ok(tool, name);
    assert.ok(MODULE_REGISTRY[tool.module].aiActions.includes(name), `${name} is declared by its module`);
  }
});

test("a meeting's calendar file has its time in UTC, the join link and escaped text", async () => {
  const { meetingIcs } = await import("../src/lib/comms/ics");
  const ics = meetingIcs(
    { id: "m1", title: "Review; kitchen, lights", agenda: "Line one\nLine two", startsAt: "2026-10-20T08:00:00.000Z", durationMin: 45, status: "scheduled" },
    "https://fundur.example/projects/p/conversations/meetings/m1",
  );
  const unfolded = ics.replace(/\r\n /g, "");
  assert.match(unfolded, /DTSTART:20261020T080000Z\r\n/);
  assert.match(unfolded, /DTEND:20261020T084500Z\r\n/);
  assert.match(unfolded, /SUMMARY:Review\\; kitchen\\, lights\r\n/);
  assert.match(unfolded, /DESCRIPTION:Line one\\nLine two\\n\\nJoin: https:\/\/fundur\.example/);
  assert.ok(ics.split("\r\n").every((l) => l.length <= 75));
});
