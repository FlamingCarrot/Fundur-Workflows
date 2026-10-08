import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectSync } from "../src/lib/studio/sync";
import { makeSeedProjects } from "../src/lib/studio/seed";
import type { Project } from "../src/lib/studio/types";

const base = makeSeedProjects()[0];

/** A fake server that answers each write when told to, echoing the body it got. */
function fakeServer() {
  const calls: {
    url: string;
    body: Record<string, unknown>;
    answer: () => void;
    fail: () => void;
  }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) =>
    new Promise<Response>((resolve) => {
      const body = JSON.parse(String(init.body));
      calls.push({
        url,
        body,
        answer: () =>
          resolve(
            Response.json({
              project: { ...base, lastActivity: String(calls.length) },
            }),
          ),
        fail: () => resolve(new Response("nope", { status: 500 })),
      });
    })) as typeof fetch;
  return { calls, fetchImpl };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("phase completion waits for the saved response and returns a refused advancement unchanged", async () => {
  const server = fakeServer();
  const sync = new ProjectSync({ onSaved: () => {}, fetchImpl: server.fetchImpl });
  let resolved = false;
  const work = sync.mutate(base.id, { type: "completePhase", phaseKey: base.currentPhase }).then((saved) => { resolved = true; return saved; });
  await tick();
  assert.equal(resolved, false);
  server.calls[0].answer();
  const saved = await work;
  assert.equal(saved.currentPhase, base.currentPhase);
  assert.equal(saved.completedPhases.includes(base.currentPhase), false);
});

test("writes go one at a time, in order", async () => {
  const server = fakeServer();
  const sync = new ProjectSync({
    onSaved: () => {},
    fetchImpl: server.fetchImpl,
  });
  const first = sync.mutate(base.id, {
    type: "setWaitingOn",
    waitingOn: "client",
  });
  const second = sync.mutate(base.id, {
    type: "setWaitingOn",
    waitingOn: "me",
  });
  await tick();
  assert.equal(server.calls.length, 1);
  server.calls[0].answer();
  await first;
  await tick();
  assert.equal(server.calls.length, 2);
  assert.equal(server.calls[1].body.waitingOn, "me");
  server.calls[1].answer();
  await second;
});

test("saved copies are held until no write is in flight", async () => {
  const server = fakeServer();
  const delivered: Project[][] = [];
  const sync = new ProjectSync({
    onSaved: (s) => delivered.push(s.map((x) => x.project)),
    fetchImpl: server.fetchImpl,
  });
  const first = sync.mutate(base.id, {
    type: "setWaitingOn",
    waitingOn: "client",
  });
  const second = sync.mutate(base.id, {
    type: "setWaitingOn",
    waitingOn: "me",
  });
  await tick();
  server.calls[0].answer();
  await first;
  assert.equal(delivered.length, 0);
  await tick();
  server.calls[1].answer();
  await second;
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0][0].lastActivity, "2");
});

test("brief typing is sent as one patch, and AI drafts are never merged with a person's edits", async () => {
  const server = fakeServer();
  const sync = new ProjectSync({
    onSaved: () => {},
    fetchImpl: server.fetchImpl,
    briefDelayMs: 10_000,
  });
  sync.queueBrief(base.id, { headcount: "1" }, false);
  sync.queueBrief(base.id, { headcount: "14" }, false);
  sync.queueBrief(base.id, { notes: "Warm" }, false);
  assert.deepEqual(sync.pendingBrief(base.id), {
    patch: { headcount: "14", notes: "Warm" },
    fromAi: false,
  });
  sync.queueBrief(base.id, { notes: "AI text" }, true);
  await tick();
  assert.equal(server.calls.length, 1);
  assert.deepEqual(server.calls[0].body, {
    type: "updateBrief",
    patch: { headcount: "14", notes: "Warm" },
    fromAi: false,
  });
  server.calls[0].answer();
  const flushed = sync.flushBrief(base.id);
  await tick();
  await tick();
  assert.deepEqual(server.calls[1].body, {
    type: "updateBrief",
    patch: { notes: "AI text" },
    fromAi: true,
  });
  server.calls[1].answer();
  await flushed;
  assert.equal(sync.idle, true);
});

test("a failed write is reported and rejects for whoever awaits it", async () => {
  const server = fakeServer();
  const errors: unknown[] = [];
  const sync = new ProjectSync({
    onSaved: () => {},
    fetchImpl: server.fetchImpl,
  });
  sync.setErrorHandler((err) => errors.push(err));
  const write = sync.mutate(base.id, {
    type: "setWaitingOn",
    waitingOn: "client",
  });
  await tick();
  server.calls[0].fail();
  await assert.rejects(write);
  assert.equal(errors.length, 1);
  // The queue keeps going after a failure.
  const next = sync.mutate(base.id, { type: "setWaitingOn", waitingOn: "me" });
  await tick();
  server.calls[1].answer();
  await next;
});

test("a load that a local change overtook is dropped instead of undoing the change", async () => {
  let answerLoad: () => void = () => {};
  const server = fakeServer();
  const fetchImpl = ((url: string, init?: RequestInit) =>
    url === "/api/projects" && !init?.method
      ? new Promise<Response>(
          (resolve) =>
            (answerLoad = () => resolve(Response.json({ projects: [base] }))),
        )
      : server.fetchImpl(url, init!)) as typeof fetch;
  const sync = new ProjectSync({ onSaved: () => {}, fetchImpl });

  const load = sync.load();
  await tick();
  const write = sync.mutate(base.id, {
    type: "setWaitingOn",
    waitingOn: "client",
  });
  await tick();
  server.calls[0].answer();
  await write;
  answerLoad();
  assert.equal(await load, null);

  // With nothing changed meanwhile, the load is used.
  const fresh = sync.load();
  await tick();
  answerLoad();
  assert.deepEqual(await fresh, [base]);
});

test("creating returns the id the server saved the project under", async () => {
  const fetchImpl = (async () =>
    Response.json({
      project: { ...base, id: "harbour-house-x1" },
    })) as unknown as typeof fetch;
  const sync = new ProjectSync({ onSaved: () => {}, fetchImpl });
  const saved = await sync.create({
    id: "harbour-house",
    name: "Harbour House",
    client: "Harbour",
    workflowId: base.workflowId,
    startDate: base.startDate,
    swatch: "clay",
  });
  assert.equal(saved.id, "harbour-house-x1");
});

test("navigation waits for an already-started brief write and a failed batch can be retried", async () => {
  const server = fakeServer();
  const sync = new ProjectSync({
    onSaved: () => {},
    fetchImpl: server.fetchImpl,
    briefDelayMs: 60_000,
  });
  sync.queueBrief(base.id, { notes: "Keep this site note" }, false);
  const saving = sync.flushBrief(base.id);
  let finished = false;
  const navigation = sync.flushBrief(base.id).then(() => {
    finished = true;
  });
  const failures = Promise.all([
    assert.rejects(saving),
    assert.rejects(navigation),
  ]);
  await tick();
  assert.equal(finished, false);
  server.calls[0].fail();
  await failures;
  assert.equal(finished, false);
  assert.equal(sync.idle, false);
  sync.queueBrief(base.id, { notes: "A later human note" }, false);
  const retry = sync.flushBrief(base.id);
  await tick();
  assert.equal(
    server.calls[1].body.patch &&
      (server.calls[1].body.patch as Record<string, string>).notes,
    "Keep this site note",
  );
  server.calls[1].answer();
  await tick();
  assert.equal(
    (server.calls[2].body.patch as Record<string, string>).notes,
    "A later human note",
  );
  server.calls[2].answer();
  await retry;
  assert.equal(sync.idle, true);
});
