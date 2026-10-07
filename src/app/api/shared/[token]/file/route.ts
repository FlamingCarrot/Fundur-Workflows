import { getDb } from "@/lib/db";
import { openFile } from "@/lib/storage/blob";
import { sharedFile } from "@/lib/sharing/store";
import { shareJson, shareFailure, PUBLIC_HEADERS } from "@/lib/sharing/http";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const db = getDb();
  if (!db) return shareJson({ error: "This link is unavailable" }, 404);
  try {
    const file = await sharedFile(db, (await params).token);
    const opened = await openFile(file.pathname);
    if (!opened) return shareJson({ error: "This file is unavailable" }, 404);
    const ascii = file.name
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_");
    const preview =
      new URL(req.url).searchParams.get("preview") === "1" &&
      /^image\/(png|jpeg|gif|webp)$/.test(opened.contentType);
    return new Response(opened.stream, {
      headers: {
        ...PUBLIC_HEADERS,
        "Content-Type": preview
          ? opened.contentType
          : "application/octet-stream",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        ...(opened.size ? { "Content-Length": String(opened.size) } : {}),
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      },
    });
  } catch (e) {
    return shareFailure(e);
  }
}
