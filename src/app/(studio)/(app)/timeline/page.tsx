import type { Metadata } from "next";
import { TimelineView } from "@/components/views/TimelineView";
import "./timeline.css";

export const metadata: Metadata = { title: "Timeline · Fundur" };

export default function TimelinePage() {
  return <TimelineView />;
}
