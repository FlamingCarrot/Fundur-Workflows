import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject } from "@/lib/server/workspace-context";
import { publicLink } from "@/lib/sourcing/import-schema";
import { readPublicPage, SupplierPageError } from "@/lib/sourcing/public-page";
import { extractProducts } from "@/lib/sourcing/extract-product";
import { getDesign } from "@/lib/design/store";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params,
    ctx = await requireProject(id, "project:edit", "design");
  if (ctx instanceof NextResponse) return ctx;
  const text = await req.text();
  if (text.length > 3000)
    return NextResponse.json(
      { error: "Paste a product link up to 2,000 characters." },
      { status: 413 },
    );
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "Could not read the product link." },
      { status: 400 },
    );
  }
  const parsed = z.object({ url: publicLink }).strict().safeParse(raw);
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  try {
    const { data } = await getDesign(ctx.db, ctx.workspaceId, id),
      page = await readPublicPage(parsed.data.url);
    return NextResponse.json(
      extractProducts(page.html, page.url, data.currency),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    if (e instanceof SupplierPageError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json(
      {
        error:
          "This supplier page could not be read. Enter its product details manually.",
      },
      { status: 502 },
    );
  }
}
