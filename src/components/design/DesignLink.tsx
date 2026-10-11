"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
/** Finish the save before moving to the next view of the same records. */
export function DesignLink({
  flush,
  ...props
}: ComponentProps<typeof Link> & { flush: () => Promise<boolean> }) {
  const router = useRouter();
  return (
    <Link
      {...props}
      onClick={async (e) => {
        props.onClick?.(e);
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        )
          return;
        e.preventDefault();
        if (await flush())
          router.push(
            typeof props.href === "string"
              ? props.href
              : String(props.href.pathname),
          );
      }}
    />
  );
}
