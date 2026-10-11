/** The public site's pages: anyone may read these without signing in. */
export const PUBLIC_PAGES = ["/welcome", "/features", "/pricing", "/about", "/legal"];

export function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
