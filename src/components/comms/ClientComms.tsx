"use client";
import { Suspense, useState } from "react";
import { MessagesSquare, Video } from "lucide-react";
import { Conversations } from "./Conversations";
import { MeetingsPanel } from "./Meetings";
import { MeetingView } from "./MeetingView";
import { useClientComms } from "./useComms";
import "./comms.css";

/** The client's side of a project's conversations and meetings, on their invite-only page. */
export function ClientComms({ token, projectId }: { token: string; projectId: string }) {
  const backend = useClientComms(token, projectId);
  const [tab, setTab] = useState<"chat" | "meetings">("chat");
  const meetingHref = (id: string) => `/client/${encodeURIComponent(token)}/meetings/${id}`;
  return (
    <section className="client-comms stack" style={{ gap: "0.9rem" }} aria-label="Messages and meetings">
      <div className="row-between wrap" style={{ gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Talk to the studio</h2>
        <div className="segmented" role="group" aria-label="Messages or meetings">
          <button type="button" aria-pressed={tab === "chat"} onClick={() => setTab("chat")}>
            <MessagesSquare size={15} /> Messages
          </button>
          <button type="button" aria-pressed={tab === "meetings"} onClick={() => setTab("meetings")}>
            <Video size={15} /> Meetings
          </button>
        </div>
      </div>
      {tab === "chat" ? <Conversations backend={backend} meetingHref={meetingHref} /> : <MeetingsPanel backend={backend} meetingHref={meetingHref} />}
    </section>
  );
}

/** One meeting on the client's page: when it is, the Join button and its chat. */
export function ClientMeeting({ token, projectId, meetingId }: { token: string; projectId: string; meetingId: string }) {
  const backend = useClientComms(token, projectId);
  return (
    <Suspense>
      <MeetingView backend={backend} meetingId={meetingId} backHref={`/client/${encodeURIComponent(token)}`} backLabel="Back to the project" />
    </Suspense>
  );
}
