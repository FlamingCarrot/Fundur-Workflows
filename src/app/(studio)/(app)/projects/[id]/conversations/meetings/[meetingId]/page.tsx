import { ProjectMeetingView } from "@/components/comms/ProjectComms";

/** One meeting: its call, notes, transcript, recordings and chat. */
export default async function MeetingPage({ params }: { params: Promise<{ id: string; meetingId: string }> }) {
  const { id, meetingId } = await params;
  return <ProjectMeetingView projectId={id} meetingId={meetingId} />;
}
