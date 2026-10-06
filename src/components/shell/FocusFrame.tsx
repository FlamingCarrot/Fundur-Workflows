"use client";

import React from "react";
import Link from "next/link";
import { X } from "lucide-react";

/**
 * Full-screen frame for single-task flows: no navigation, one clear exit,
 * an optional progress line and a sticky action footer.
 */
export function FocusFrame({
  exitHref,
  exitLabel = "Close",
  title,
  right,
  progress,
  footer,
  wide,
  children,
}: {
  exitHref: string;
  exitLabel?: string;
  title?: React.ReactNode;
  right?: React.ReactNode;
  progress?: number;
  footer?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="focus">
      <div style={{ position: "sticky", top: 0, zIndex: 20 }}>
        <div className="focus-bar">
          <Link href={exitHref} className="icon-btn" aria-label={exitLabel} title={exitLabel}>
            <X size={19} />
          </Link>
          <div className="small strong truncate" style={{ textAlign: "center" }}>{title}</div>
          <div>{right}</div>
        </div>
        {progress != null && (
          <div className="focus-progress">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      <main className={`focus-body${wide ? " wide" : ""}`}>{children}</main>
      {footer && (
        <div className="focus-footer">
          <div className="focus-footer-inner">{footer}</div>
        </div>
      )}
    </div>
  );
}
