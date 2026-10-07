import { redirect } from "next/navigation";

// Layout rules belong to interior design projects and live in each one's settings.
export default function RulesPage() {
  redirect("/projects");
}
