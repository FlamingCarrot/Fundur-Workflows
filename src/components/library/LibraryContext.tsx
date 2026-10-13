"use client";

import { createContext, useContext, type ReactNode } from "react";
import { STANDARD, type Resolver } from "@/lib/blueprints/resolve";
import { useDesignLibrary, type DesignLibrary } from "@/lib/blueprints/client";
import { useStudio } from "@/components/providers/StudioProvider";

/**
 * Hands the design library to everything that draws items: the 2D plan, the 3D
 * view, symbols and pickers. Without a provider the defaults are used.
 */
const ResolverContext = createContext<Resolver>(STANDARD);
const LibraryContext = createContext<DesignLibrary | null>(null);

/** The practice's design library, live, for the signed-in workspace (or this browser in the demo). */
export function useLibrary(): DesignLibrary {
  const { persistence, viewer } = useStudio();
  return useDesignLibrary(persistence === "server", `${viewer.userId ?? "demo"}.${viewer.workspaceId ?? "demo"}`);
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const library = useLibrary();
  return (
    <LibraryContext.Provider value={library}>
      <ResolverContext.Provider value={library.resolver}>{children}</ResolverContext.Provider>
    </LibraryContext.Provider>
  );
}

export function useResolver(): Resolver {
  return useContext(ResolverContext);
}

/** The library from the nearest provider; screens outside one get their own. */
export function useLibraryContext(): DesignLibrary | null {
  return useContext(LibraryContext);
}
