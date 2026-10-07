import type { Metadata } from "next";
import { TasksView } from "@/components/views/TasksView";

export const metadata: Metadata = { title: "Due list · Fundur" };

export default function TasksPage() {
  return <TasksView />;
}
