import type { Metadata } from "next";
import { BoardView } from "@/components/views/BoardView";

export const metadata: Metadata = { title: "Task board · Fundur" };

export default function BoardPage() {
  return <BoardView />;
}
