/** These handlers authorize access using their own bearer token, not a studio session. */
export function isPublicTokenRoute(pathname: string): boolean {
  return /^\/share\/[^/]{1,128}$/.test(pathname)
    || /^\/api\/shared\/[A-Za-z0-9_-]{43}(?:\/(?:file|comments|approval))?$/.test(pathname)
    || /^\/invite\/[^/]{1,128}$/.test(pathname)
    || /^\/book\/[A-Za-z0-9_-]{43}$/.test(pathname)
    || /^\/api\/book\/[A-Za-z0-9_-]{43}$/.test(pathname)
    || /^\/api\/calendar\/feed\/[A-Za-z0-9_-]{43}(?:\.ics)?$/.test(pathname)
    || pathname === "/access-denied";
}
