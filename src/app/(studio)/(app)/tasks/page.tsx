import type { Metadata } from "next";
import { TasksView } from "@/components/views/TasksView";

export const metadata: Metadata = { title: "To-do list · Fundur" };

export default function TasksPage() {
  return <TasksView />;
}
