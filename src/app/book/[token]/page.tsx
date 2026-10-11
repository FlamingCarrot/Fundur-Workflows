import type { Metadata } from "next";
import { BookingPage } from "@/components/booking/BookingPage";

export const metadata: Metadata = {
  title: { absolute: "Book a meeting" },
  description: "Pick a time to meet.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function BookPage({ params }: { params: Promise<{ token: string }> }) {
  return <BookingPage token={(await params).token} />;
}
