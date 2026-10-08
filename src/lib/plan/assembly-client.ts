import { assemblyInput, type Assembly, type AssemblyInput } from "./groups";
async function call<T>(method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api/plan-library", {
    method,
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
export function assemblyLibrary(server: boolean, scope: string) {
  const key = `fundur.assemblies.v1.${scope}`;
  const read = (): Assembly[] => {
    const rows: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(rows))
      throw new Error("The demo library could not be read.");
    return rows.filter(
      (r) =>
        assemblyInput.safeParse(r).success &&
        typeof r.id === "string" &&
        typeof r.createdAt === "string",
    );
  };
  return {
    list: async (): Promise<Assembly[]> =>
      server ? (await call<{ assemblies: Assembly[] }>()).assemblies : read(),
    create: async (input: AssemblyInput): Promise<Assembly> => {
      if (server)
        return (await call<{ assembly: Assembly }>("POST", input)).assembly;
      const rows = read();
      if (rows.length >= 200) throw new Error("The demo library is full.");
      const assembly = {
        ...assemblyInput.parse(input),
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem(key, JSON.stringify([assembly, ...rows]));
      return assembly;
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
