import type { Metadata } from "next";
import { NewProjectFlow } from "@/components/views/NewProjectFlow";

export const metadata: Metadata = { title: "New project · Fundur" };

export default function NewProjectPage() {
  return <NewProjectFlow />;
}
