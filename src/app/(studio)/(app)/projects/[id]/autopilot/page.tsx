import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { AutopilotView } from "@/components/autopilot/AutopilotView";

/** The project's autopilot: on or off, how much it does, what it did and what it asks. */
export default async function AutopilotPage({ params }: { params: Promise<{ id: string }> }) {
  if ((await getViewer()).features?.ai === false) notFound();
  return <AutopilotView projectId={(await params).id} />;
}
