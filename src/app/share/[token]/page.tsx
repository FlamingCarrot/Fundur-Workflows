import type { Metadata } from "next";
import { SharedReader } from "@/components/sharing/SharedReader";
export const metadata: Metadata = {
  title: { absolute: "Shared document" },
  description: "A privately shared project document.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
  },
};
export default async function SharedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <SharedReader token={(await params).token} />;
}
