import {notFound} from "next/navigation";
import {getViewer} from "@/lib/server/workspace-context";
import type { Metadata } from "next";
import { NewProjectFlow } from "@/components/views/NewProjectFlow";

export const metadata: Metadata = { title: "New project · Fundur" };

export default async function NewProjectPage() {
  const viewer=await getViewer();
  if(viewer.workspaceRole && viewer.workspaceRole!=="owner")notFound();
  return <NewProjectFlow />;
}
