import type { Metadata } from "next";
import { BusinessView } from "@/components/business/BusinessView";

export const metadata: Metadata = { title: "Business · Fundur" };

export default function BusinessPage() {
  return <BusinessView />;
}
