import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { BlueprintEditor } from "@/components/library/BlueprintEditor";

export const metadata: Metadata = { title: "Blueprint · Fundur" };

export default async function BlueprintPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (viewer.features?.floor_plan === false) notFound();
  const { id: raw } = await params;
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    notFound();
  }
  return <BlueprintEditor key={id} id={id} />;
}
