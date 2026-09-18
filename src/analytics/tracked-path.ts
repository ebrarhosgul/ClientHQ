/**
 * Where the browser analytics client may exist at all (spec 0019, AC-14):
 * everywhere except the client portal. Shared by the gate that mounts the
 * client and the banner that asks consent for it, so the two can never
 * disagree about a path.
 */
export function isTrackedPath(pathname: string | null): boolean {
  // `usePathname()` is null only outside the App Router (a bare render in a
  // test); nothing there is the portal.
  return (
    pathname === null ||
    (pathname !== "/portal" && !pathname.startsWith("/portal/"))
  );
}
