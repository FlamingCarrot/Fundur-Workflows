import { TeamSpaceView } from "@/components/team/TeamSpaceView";

/** The project's shared whiteboard, chats and comments. */
export default async function TeamSpacePage({ params }: { params: Promise<{ id: string }> }) {
  return <TeamSpaceView projectId={(await params).id} />;
}
