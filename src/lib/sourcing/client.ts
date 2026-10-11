import {
  sourcingEntryInput,
  type SourcingEntry,
  type SourcingEntryInput,
} from "./schema";
async function call<T>(method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api/sourcing-library", {
    method,
    cache: "no-store",
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }
      : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error ?? "The practice library could not be reached.");
  return data;
}
export function sourcingLibrary(server: boolean, scope: string) {
  const key = `fundur.sourcing-library.v1.${scope}`;
  const read = (): SourcingEntry[] => {
    const rows: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(rows))
      throw new Error("The demo sourcing library could not be read.");
    return rows.filter(
      (r): r is SourcingEntry =>
        !!r &&
        typeof r === "object" &&
        sourcingEntryInput.safeParse({
          kind: (r as SourcingEntry).kind,
          data: (r as SourcingEntry).data,
          id: (r as SourcingEntry).id,
        }).success &&
        typeof (r as SourcingEntry).createdAt === "string",
    );
  };
  return {
    list: async (): Promise<SourcingEntry[]> =>
      server ? (await call<{ entries: SourcingEntry[] }>()).entries : read(),
    save: async (input: SourcingEntryInput): Promise<SourcingEntry> => {
      if (server)
        return (await call<{ entry: SourcingEntry }>("POST", input)).entry;
      const checked = sourcingEntryInput.parse(input),
        rows = read(),
        existing = rows.find((r) => r.id === checked.id);
      if (checked.id && (!existing || existing.kind !== checked.kind))
        throw new Error("Library entry not found.");
      if (
        !checked.id &&
        rows.filter((r) => r.kind === checked.kind).length >=
          (checked.kind === "supplier" ? 500 : 50)
      )
        throw new Error("The practice library is full.");
      const entry = {
        ...checked,
        id: checked.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      } as SourcingEntry;
      localStorage.setItem(
        key,
        JSON.stringify([...rows.filter((r) => r.id !== entry.id), entry]),
      );
      return entry;
    },
    remove: async (id: string): Promise<void> => {
      if (server) await call("DELETE", { id });
      else
        localStorage.setItem(
          key,
          JSON.stringify(read().filter((r) => r.id !== id)),
        );
    },
  };
}
