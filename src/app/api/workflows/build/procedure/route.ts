import { NextResponse } from "next/server";
import {
  requireWorkspace,
  requirePermission,
} from "@/lib/server/workspace-context";
import { readProcedure, PROCEDURE_BYTES } from "@/lib/workflow/procedure";
import { BuilderError } from "@/lib/workflow/builder-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(req: Request) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requirePermission(ctx, "workflow:edit");
  if (denied) return denied;
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > PROCEDURE_BYTES + 50000)
    return NextResponse.json(
      { error: "Choose a procedure file up to 3 MB." },
      { status: 400 },
    );
  try {
    const data = await req.formData(),
      file = data.get("file");
    if (!(file instanceof File) || file.size > PROCEDURE_BYTES)
      throw new BuilderError("Choose one procedure file up to 3 MB.");
    const text = await readProcedure(
      file.name,
      new Uint8Array(await file.arrayBuffer()),
    );
    return NextResponse.json(
      { text },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof BuilderError
            ? e.message
            : "The procedure could not be uploaded.",
      },
      { status: 400 },
    );
  }
}
