import type { Blueprint, Material } from "./types";

/** The body the server stores: the entry without its id, revision and stamps. */
export function bodyOf<T extends Blueprint | Material>(entry: T): Omit<T, "id" | "revision" | "updatedAt" | "updatedBy" | "createdBy"> {
  const { id: _i, revision: _r, updatedAt: _u, updatedBy: _b, createdBy: _c, ...body } = entry as T & { updatedBy?: string };
  void _i;
  void _r;
  void _u;
  void _b;
  void _c;
  return body;
}
