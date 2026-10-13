import { NextRequest, NextResponse } from "next/server";
import { listVersions } from "@/lib/blueprints/store";
import { libraryContext, noStore } from "../../context";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await libraryContext(false);
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ versions: await listVersions(ctx.db, ctx.workspaceId, (await params).id) }, { headers: noStore });
}
