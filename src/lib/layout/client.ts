import { DEFAULT_RULES, DEFAULT_RULE_SET_NAME, normalizeRules, type LayoutRules, type RuleSet } from "./rules";

/**
 * The rules screen's calls. With the server set up they go to the API; in the
 * demo the rule sets are kept in this browser, with the same rules (one set
 * always stays, a stale save is refused).
 */

export class RuleSetConflict extends Error {
  constructor(public readonly current: RuleSet) {
    super("These rules were changed in another window since you opened them.");
  }
}

export interface RuleSetBackend {
  list(): Promise<RuleSet[]>;
  create(name: string, rules: LayoutRules): Promise<RuleSet>;
  update(id: string, name: string, rules: LayoutRules, baseRevision: number): Promise<RuleSet>;
  remove(id: string): Promise<void>;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 409 && body.current) throw new RuleSetConflict(body.current as RuleSet);
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const serverRuleSets: RuleSetBackend = {
  list: () => call<{ ruleSets: RuleSet[] }>("/api/layout-rules").then((b) => b.ruleSets),
  create: (name, rules) =>
    call<{ ruleSet: RuleSet }>("/api/layout-rules", { method: "POST", body: JSON.stringify({ name, rules }) }).then((b) => b.ruleSet),
  update: (id, name, rules, baseRevision) =>
    call<{ ruleSet: RuleSet }>(`/api/layout-rules/${id}`, { method: "PUT", body: JSON.stringify({ name, rules, baseRevision }) }).then(
      (b) => b.ruleSet
    ),
  remove: (id) => call(`/api/layout-rules/${id}`, { method: "DELETE" }).then(() => undefined),
};

const KEY = "fundur.layoutRules.v1";

function read(by: string): RuleSet[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const sets = (JSON.parse(raw) as RuleSet[]).map((s) => ({ ...s, rules: normalizeRules(s.rules) }));
      if (sets.length) return sets;
    }
  } catch {
    // Storage blocked or unreadable: start from the starting set.
  }
  const first: RuleSet = { id: crypto.randomUUID(), name: DEFAULT_RULE_SET_NAME, rules: DEFAULT_RULES, revision: 1, updatedAt: new Date().toISOString(), updatedBy: by };
  write([first]);
  return [first];
}

function write(sets: RuleSet[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sets));
  } catch {
    // A full or blocked store: the rules last for this visit only.
  }
}

export function localRuleSets(by: string): RuleSetBackend {
  return {
    list: async () => read(by),
    create: async (name, rules) => {
      const set: RuleSet = { id: crypto.randomUUID(), name, rules, revision: 1, updatedAt: new Date().toISOString(), updatedBy: by };
      write([...read(by), set]);
      return set;
    },
    update: async (id, name, rules, baseRevision) => {
      const sets = read(by);
      const current = sets.find((s) => s.id === id);
      if (!current) throw new Error("Those rules no longer exist");
      if (current.revision !== baseRevision) throw new RuleSetConflict(current);
      const next: RuleSet = { ...current, name, rules, revision: current.revision + 1, updatedAt: new Date().toISOString(), updatedBy: by };
      write(sets.map((s) => (s.id === id ? next : s)));
      return next;
    },
    remove: async (id) => {
      const sets = read(by);
      if (sets.length <= 1) throw new Error("The last set of rules stays, so there is always one to lay out with");
      write(sets.filter((s) => s.id !== id));
    },
  };
}
