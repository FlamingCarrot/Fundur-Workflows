import type { Metadata } from "next";
import { InboxView } from "@/components/autopilot/InboxView";

export const metadata: Metadata = { title: "Inbox · Fundur" };

export default function InboxPage() {
  return <InboxView />;
}
