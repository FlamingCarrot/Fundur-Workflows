import type { Metadata } from "next";
import { ProjectsView } from "@/components/views/ProjectsView";

export const metadata: Metadata = { title: "Projects · Fundur" };

export default function ProjectsPage() {
  return <ProjectsView />;
}
