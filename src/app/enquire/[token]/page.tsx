import type { Metadata } from "next";
import { EnquiryPage } from "@/components/business/EnquiryPage";

export const metadata: Metadata = { title: { absolute: "Start a project" }, robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Enquire({ params }: { params: Promise<{ token: string }> }) {
  return <EnquiryPage token={(await params).token} />;
}
