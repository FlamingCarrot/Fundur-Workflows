import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site/company";

export const PUBLIC_SITE_PATHS = [
  "/",
  "/features",
  "/pricing",
  "/about",
  "/legal",
  "/legal/terms",
  "/legal/privacy",
  "/legal/cookies",
  "/legal/acceptable-use",
  "/legal/ai",
  "/legal/paia",
  "/legal/company",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PUBLIC_SITE_PATHS.map((path) => ({ url: new URL(path, base).toString() }));
}
