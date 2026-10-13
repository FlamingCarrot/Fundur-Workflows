import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { assertStorageFor, limitResponse, PlanLimitError } from "@/lib/billing/guard";
import { isStorageConfigured } from "@/lib/storage/blob";
import { clientScope, clientUploadPrefix, CLIENT_UPLOAD_BYTES, commsJson } from "@/lib/comms/http";

export const dynamic = "force-dynamic";

async function scope(token: string) {
  const s = await clientScope(token);
  if (s instanceof NextResponse) return s;
  if (!isStorageConfigured()) return commsJson({ error: "Sending files is not set up yet" }, 503);
  return s;
}

/** The folder an invited client's files go into: their own, inside the project's. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const s = await scope((await ctx.params).token);
  if (s instanceof NextResponse) return s;
  return commsJson({ prefix: clientUploadPrefix(s), maxBytes: CLIENT_UPLOAD_BYTES });
}

/** A one-off permission for the client's browser to upload one file, into their folder only. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const s = await scope((await ctx.params).token);
  if (s instanceof NextResponse) return s;
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return commsJson({ error: "Bad upload request" }, 400);
  if (body.type === "blob.generate-client-token") {
    try {
      await assertStorageFor({ db: s.db, workspaceId: s.workspaceId, user: { platformRole: "user" } }, 1);
    } catch (err) {
      if (err instanceof PlanLimitError) return limitResponse(err);
      throw err;
    }
  }
  try {
    const prefix = clientUploadPrefix(s);
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const rest = pathname.slice(prefix.length);
        if (!pathname.startsWith(prefix) || !rest || rest.includes("/") || rest.startsWith(".")) throw new Error("Files can only go into your folder");
        return { maximumSizeInBytes: CLIENT_UPLOAD_BYTES, addRandomSuffix: true, allowOverwrite: false };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return commsJson({ error: (err as Error).message }, 400);
  }
}
