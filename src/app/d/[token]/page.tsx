import type { Metadata } from "next";
import { PublicDocPage } from "@/components/business/PublicDocPage";

export const metadata: Metadata = { title: { absolute: "Document" }, robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function DocPage({ params }: { params: Promise<{ token: string }> }) {
  return <PublicDocPage token={(await params).token} />;
}
