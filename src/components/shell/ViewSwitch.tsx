"use client";

import { usePathname, useRouter } from "next/navigation";
import { useStudio } from "@/components/providers/StudioProvider";

/** Pages only the Admin sees; switching to basic view leaves them. */
export function isAdminPath(pathname: string): boolean {
  return pathname.startsWith("/settings");
}

/**
 * The Admin's switch between seeing everything and seeing exactly what a basic
 * user sees. It takes effect at once and is kept with them for next time.
 */
export function ViewSwitch() {
  const { viewer, setViewMode, toast } = useStudio();
  const router = useRouter();
  const pathname = usePathname();
  if (!viewer.canAdmin) return null;

  const choose = (mode: "admin" | "basic") => {
    if ((mode === "admin") === viewer.isAdmin) return;
    if (mode === "basic" && isAdminPath(pathname)) router.push("/");
    void setViewMode(mode).then((ok) => {
      if (!ok) toast("Couldn't switch views. Please try again.");
      // Server-drawn pages pick up the new view too.
      else router.refresh();
    });
  };

  return (
    <div className="segmented segmented-sm view-switch" role="group" aria-label="View as">
      <button type="button" aria-pressed={viewer.isAdmin} onClick={() => choose("admin")}>
        Admin
      </button>
      <button type="button" aria-pressed={!viewer.isAdmin} onClick={() => choose("basic")}>
        Basic view
      </button>
    </div>
  );
}
