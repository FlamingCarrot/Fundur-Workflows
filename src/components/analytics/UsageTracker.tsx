"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { startTracking, trackPage } from "@/lib/analytics/client";

/**
 * Records how the app is used (usage analytics) for the Admin's usage pages
 * and advisor. Only runs when people are signed in and the database is set
 * up; the demo keeps nothing.
 */
export function UsageTracker({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  useEffect(() => (enabled ? startTracking() : undefined), [enabled]);
  useEffect(() => {
    if (enabled && pathname) trackPage(pathname);
  }, [enabled, pathname]);
  return null;
}
