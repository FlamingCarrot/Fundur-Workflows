import type { Metadata } from "next";
import { CalendarSettingsView } from "@/components/views/CalendarSettingsView";

export const metadata: Metadata = { title: "Calendar settings · Fundur" };

export default function CalendarSettingsPage() {
  return <CalendarSettingsView />;
}
