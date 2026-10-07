import { NextResponse } from "next/server";
import { ShareError } from "./store";
export const PUBLIC_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};
export function shareJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: PUBLIC_HEADERS });
}
export function shareFailure(error: unknown) {
  if (error instanceof ShareError)
    return shareJson({ error: error.message }, error.status);
  console.error(
    "Sharing request failed",
    error instanceof Error ? error.name : "unknown",
  );
  return shareJson(
    { error: "This request could not be completed. Please try again." },
    500,
  );
}
export function checkOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return origin && origin !== new URL(req.url).origin
    ? shareJson({ error: "Request not allowed" }, 403)
    : null;
}
