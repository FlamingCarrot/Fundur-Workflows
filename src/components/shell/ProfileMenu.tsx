"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, LifeBuoy, LogIn, LogOut, MessageCircleQuestion } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { initials } from "@/components/ui/primitives";
import { ViewSwitch } from "./ViewSwitch";

/** On phones, the avatar opens what the sidebar's profile area holds: the view switch, help and sign out. */
export function ProfileMenu({ supportUnread }: { supportUnread: number }) {
  const { viewer, setIssueSheetOpen } = useStudio();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="profile-menu" ref={ref}>
      <button
        type="button"
        className="avatar avatar-btn"
        aria-label="Your account"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {initials(viewer.name)}
        {supportUnread > 0 && <span className="avatar-dot" aria-hidden />}
      </button>
      {open && (
        <div className="profile-pop card" role="menu">
          <div className="stack" style={{ gap: "0.1rem", marginBottom: "0.6rem" }}>
            <span className="small strong truncate">{viewer.name}</span>
            <span className="tiny muted truncate">{viewer.isAdmin ? "Admin" : viewer.workspace}</span>
          </div>
          <ViewSwitch />
          <div className="stack" style={{ gap: "0.15rem", marginTop: "0.5rem" }}>
            <Link href="/settings/user" className="nav-item" onClick={() => setOpen(false)}>
              <Bot size={17} />
              <span className="nav-text">AI settings</span>
            </Link>
            <Link href="/support" className="nav-item" onClick={() => setOpen(false)}>
              <MessageCircleQuestion size={17} />
              <span className="nav-text">Help &amp; support</span>
              {supportUnread > 0 && <span className="nav-badge">{supportUnread}</span>}
            </Link>
            <button
              type="button"
              className="nav-item"
              onClick={() => {
                setOpen(false);
                setIssueSheetOpen(true);
              }}
            >
              <LifeBuoy size={17} />
              <span className="nav-text" style={{ textAlign: "left" }}>Report an issue</span>
            </button>
            {viewer.signedIn ? (
              <a href="/auth/logout" className="nav-item">
                <LogOut size={17} />
                <span className="nav-text">Sign out</span>
              </a>
            ) : (
              <a href="/auth/login" className="nav-item">
                <LogIn size={17} />
                <span className="nav-text">Sign in</span>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
