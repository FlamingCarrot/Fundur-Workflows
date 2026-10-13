import type { Metadata } from "next";
import { DocEditor } from "@/components/business/DocEditor";

export const metadata: Metadata = { title: "Document · Fundur" };

export default async function BusinessDocPage({ params }: { params: Promise<{ docId: string }> }) {
  const { docId } = await params;
  return <DocEditor id={docId} />;
}
