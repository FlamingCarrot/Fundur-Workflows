import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site/company";

/** Search engines may read the public site; everything else needs signing in anyway. */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: { userAgent: "*", allow: ["/$", "/welcome", "/features", "/pricing", "/about", "/legal", "/site/"], disallow: "/" },
    sitemap: new URL("/sitemap.xml", base).toString(),
  };
}
