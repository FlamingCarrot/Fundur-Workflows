import { NextResponse } from "next/server";
import { libraryContext, noStore } from "../../library/context";
import { searchFree, TextureSourceError } from "@/lib/textures/free";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Free (CC0) textures matching the words, from Poly Haven. */
export async function GET(req: Request) {
  const ctx = await libraryContext(false);
  if (ctx instanceof NextResponse) return ctx;
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 120);
  try {
    return NextResponse.json({ textures: await searchFree(q) }, { headers: noStore });
  } catch (e) {
    if (e instanceof TextureSourceError) return NextResponse.json({ error: e.message }, { status: 502, headers: noStore });
    throw e;
  }
}
