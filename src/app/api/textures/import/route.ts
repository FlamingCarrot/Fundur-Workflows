import { NextResponse } from "next/server";
import { z } from "zod";
import { libraryContext, noStore } from "../../library/context";
import { importFree, TextureSourceError } from "@/lib/textures/free";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** One free texture as a material, ready to keep in the library. */
export async function POST(req: Request) {
  const ctx = await libraryContext(true);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = z.object({ id: z.string().min(1).max(80) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a texture from the list." }, { status: 400, headers: noStore });
  try {
    return NextResponse.json({ material: await importFree(parsed.data.id) }, { headers: noStore });
  } catch (e) {
    if (e instanceof TextureSourceError) return NextResponse.json({ error: e.message }, { status: 502, headers: noStore });
    console.error("Texture import failed", e instanceof Error ? e.name : "unknown");
    return NextResponse.json({ error: "That texture could not be brought in." }, { status: 502, headers: noStore });
  }
}
