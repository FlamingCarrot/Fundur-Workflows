"use client";
import { useEffect, useState, type CSSProperties } from "react";

/** Keep the conversation and send action above a phone's on-screen keyboard. */
export function useMobileDialog(maxHeight?: number): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useEffect(() => {
    const viewport = window.visualViewport;
    const refresh = () => {
      if (!window.matchMedia("(max-width: 600px)").matches) {
        setStyle(undefined);
        return;
      }
      const available = Math.max(
        120,
        (viewport?.height ?? window.innerHeight) - 16,
      );
      const height = maxHeight ? Math.min(maxHeight, available) : available;
      setStyle({
        top: (viewport?.offsetTop ?? 0) + 8 + (available - height),
        height,
        bottom: "auto",
      });
    };
    const frame = requestAnimationFrame(refresh);
    viewport?.addEventListener("resize", refresh);
    viewport?.addEventListener("scroll", refresh);
    window.addEventListener("resize", refresh);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", refresh);
      viewport?.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, [maxHeight]);
  return style;
}
