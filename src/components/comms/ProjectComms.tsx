"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MessagesSquare, Video } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady } from "@/components/ui/primitives";
import { ProjectWorkPage } from "@/components/projects/ProjectWorkPage";
import { MissingProject } from "@/components/views/MissingProject";
import { oneOf, useViewSetting } from "@/lib/view-settings/client";
import { canUseTool } from "@/lib/team/access";
import type { Project } from "@/lib/studio/types";
import { Conversations } from "./Conversations";
import { MeetingsPanel } from "./Meetings";
import { MeetingView } from "./MeetingView";
import { useProjectComms } from "./useComms";
import "./comms.css";

const TABS = ["chat", "meetings"] as const;
const isTab = oneOf(TABS);
const TOOL = "conversations";

export const projectMeetingHref = (projectId: string, meetingId: string) => `/projects/${projectId}/conversations/meetings/${meetingId}`;

function WithProject({ projectId, children }: { projectId: string; children: (p: Project) => React.ReactNode }) {
  const { ready, getProject } = useStudio();
  const project = getProject(projectId);
  return <WhenReady ready={ready}>{project && canUseTool(project.myAccess, TOOL) ? children(project) : <MissingProject />}</WhenReady>;
}

/** A project's conversations (channels and threads) and its meetings, on one page with two tabs. */
export function ProjectConversationsView({ projectId }: { projectId: string }) {
  return (
    <WithProject projectId={projectId}>
      {(project) => (
        <Suspense>
          <ProjectConversations key={project.id} project={project} />
        </Suspense>
      )}
    </WithProject>
  );
}

function ProjectConversations({ project }: { project: Project }) {
  const { persistence } = useStudio();
  const backend = useProjectComms(project.id);
  const params = useSearchParams();
  const linked = params.get("channel") || params.get("post") ? "chat" : params.get("tab") === "meetings" ? "meetings" : null;
  const [kept, setTab] = useViewSetting<(typeof TABS)[number]>("conversations.tab", "chat", isTab);
  // A link to a channel, post or the meetings opens that tab; picking a tab is remembered.
  const [override, setOverride] = useState(linked);
  const tab = override ?? kept;
  const pick = (t: (typeof TABS)[number]) => {
    setOverride(null);
    setTab(t);
  };
  return (
    <ProjectWorkPage
      project={project}
      title="Conversations and meetings"
      description={
        persistence === "server"
          ? "Channels and threads for this project, and video calls that can be recorded and transcribed. The assistant reads all of it and can carry the work on."
          : "Channels, threads and calls for this project. In the demo they stay in this browser and calls are just you; sign in to talk with your team and clients."
      }
      actions={
        <div className="segmented" role="group" aria-label="Conversations or meetings">
          <button type="button" aria-pressed={tab === "chat"} onClick={() => pick("chat")}>
            <MessagesSquare size={15} /> Chat
          </button>
          <button type="button" aria-pressed={tab === "meetings"} onClick={() => pick("meetings")}>
            <Video size={15} /> Meetings
          </button>
        </div>
      }
    >
      {tab === "chat" ? (
        <Conversations backend={backend} meetingHref={(id) => projectMeetingHref(project.id, id)} initialChannel={params.get("channel")} initialPost={params.get("post")} />
      ) : (
        <MeetingsPanel backend={backend} meetingHref={(id) => projectMeetingHref(project.id, id)} />
      )}
    </ProjectWorkPage>
  );
}

/** One meeting of a project: its call, notes, transcript, recordings and chat. */
export function ProjectMeetingView({ projectId, meetingId }: { projectId: string; meetingId: string }) {
  return (
    <WithProject projectId={projectId}>
      {(project) => (
        <Suspense>
          <ProjectMeeting key={`${project.id}:${meetingId}`} project={project} meetingId={meetingId} />
        </Suspense>
      )}
    </WithProject>
  );
}

function ProjectMeeting({ project, meetingId }: { project: Project; meetingId: string }) {
  const { addTask, receiveProject, askAssistant, viewer } = useStudio();
  const backend = useProjectComms(project.id);
  const ai = viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator";
  return (
    <ProjectWorkPage project={project} title="Meeting" description="">
      <MeetingView
        backend={backend}
        meetingId={meetingId}
        backHref={`/projects/${project.id}/conversations?tab=meetings`}
        backLabel="All meetings"
        onProject={receiveProject}
        addTasksHere={(items) => {
          for (const a of items)
            addTask(project.id, { phaseKey: project.currentPhase, title: `${a.owner ? `${a.owner}: ` : ""}${a.title}`.slice(0, 200), ...(a.due ? { due: a.due } : {}) });
        }}
        askAssistant={ai ? (prompt) => askAssistant({ projectId: project.id, prompt }) : undefined}
      />
    </ProjectWorkPage>
  );
}
