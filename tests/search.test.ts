import { test } from "node:test";
import assert from "node:assert/strict";
import { flatten, search } from "../src/lib/studio/search";
import { makeSeedProjects } from "../src/lib/studio/seed";
import type { Project } from "../src/lib/studio/types";

const projects = makeSeedProjects(Date.parse("2026-10-06T08:00:00.000Z"));
const first = projects[0];

function kinds(groups: ReturnType<typeof search>) {
  return groups.map((g) => g.kind);
}

test("a client's name brings back their projects", () => {
  const groups = search(projects, first.client);
  const client = groups.find((g) => g.kind === "client")!;
  assert.equal(client.results[0].title, first.client);
  assert.equal(client.results[0].href, `/projects/${first.id}`);
  assert.ok(client.results.every((r) => r.context.length > 0));
});

test("results are grouped by what they are, in a fixed order", () => {
  const groups = search(projects, "a");
  assert.deepEqual(groups, [], "a single letter is too little to search on");

  const all = search(projects, first.name.slice(0, 4));
  assert.deepEqual(
    kinds(all),
    kinds(all).sort((a, b) => ["project", "client", "task", "document", "brief"].indexOf(a) - ["project", "client", "task", "document", "brief"].indexOf(b))
  );
  assert.ok(flatten(all).length >= all.length);
});

test("a document is found by its name, and a step by its words", () => {
  const withDocs = projects.find((p) => p.documents.length)!;
  const doc = withDocs.documents[0];
  const docResult = search(projects, doc.name.split(" ")[0]).find((g) => g.kind === "document")?.results[0];
  assert.ok(docResult, "the document should be found by the first word of its name");
  assert.equal(docResult!.href, `/projects/${withDocs.id}/documents`);

  const taskGroup = search(projects, "site visit").find((g) => g.kind === "task");
  assert.ok(taskGroup, "a checklist step is a task and should be found");
  assert.ok(taskGroup!.results[0].href.includes("/phases/"));
});

test("a name match ranks above a mention inside the brief", () => {
  const project: Project = {
    ...first,
    id: "harbour",
    name: "Harbour House",
    client: "Someone Else",
    brief: { ...first.brief, notes: "Met the team about the harbour frontage" },
  };
  const groups = search([project], "harbour");
  assert.equal(groups[0].kind, "project");
  const brief = groups.find((g) => g.kind === "brief");
  if (brief) {
    assert.ok(brief.results[0].context.toLowerCase().includes("harbour"), "the line shows the words around the match");
    assert.ok(brief.results[0].score < groups[0].results[0].score);
  }
});

test("nothing matching gives nothing back", () => {
  assert.deepEqual(search(projects, "zzzzqqq"), []);
  assert.deepEqual(search([], "harbour"), []);
});
