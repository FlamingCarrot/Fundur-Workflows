import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { LibraryHome } from "@/components/library/LibraryHome";

export const metadata: Metadata = { title: "Design library · Fundur" };

export default async function LibraryPage() {
  const viewer = await getViewer();
  if (viewer.features?.floor_plan === false) notFound();
  return <LibraryHome />;
}
