"use client";

import Link from "next/link";
import { AlertCircle, Clock, Inbox, Mail } from "lucide-react";
import { useInbox } from "@/components/autopilot/useAutopilot";
import { money } from "@/lib/business/model";
import { useOverview } from "./useBusiness";
import "./business.css";

/** On Today: what the studio itself needs from her, beyond the projects. Hidden when nothing does. */
export function StudioPulse() {
  const { data: inbox } = useInbox();
  const { data: biz } = useOverview();
  const asks = (inbox?.asks.length ?? 0) + (inbox?.review.length ?? 0);
  const chips: { href: string; icon: React.ReactNode; text: string; tone?: "bad" }[] = [];
  if (asks) chips.push({ href: "/inbox", icon: <Inbox size={15} />, text: `${asks} in your inbox` });
  if (biz?.newLeads) chips.push({ href: "/business?tab=leads", icon: <Mail size={15} />, text: `${biz.newLeads} new ${biz.newLeads === 1 ? "enquiry" : "enquiries"}` });
  if (biz?.totals.overdueCents) chips.push({ href: "/business?tab=invoice", icon: <AlertCircle size={15} />, text: `${money(biz.totals.overdueCents, biz.currency)} overdue`, tone: "bad" });
  if (biz && biz.totals.unbilledCents >= 100_000) chips.push({ href: "/business?tab=time", icon: <Clock size={15} />, text: `${money(biz.totals.unbilledCents, biz.currency)} not billed` });
  if (!chips.length) return null;
  return (
    <nav className="studio-pulse rise" aria-label="Studio">
      {chips.map((c) => (
        <Link key={c.href} href={c.href} className="studio-pulse-chip" data-tone={c.tone}>
          {c.icon}
          {c.text}
        </Link>
      ))}
    </nav>
  );
}
