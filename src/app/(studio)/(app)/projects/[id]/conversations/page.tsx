import { ProjectConversationsView } from "@/components/comms/ProjectComms";

/** The project's conversations and meetings. */
export default async function ConversationsPage({ params }: { params: Promise<{ id: string }> }) {
  return <ProjectConversationsView projectId={(await params).id} />;
}
