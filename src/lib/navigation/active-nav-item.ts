/** One active destination: the deepest matching path, ignoring query/hash metadata. */
export function activeRouteHref(pathname: string, items: readonly { href: string }[]) {
  let active: { href: string; length: number } | undefined;
  for (const item of items) {
    const path = item.href.split(/[?#]/)[0]!;
    if ((pathname === path || pathname.startsWith(`${path}/`)) && path.length > (active?.length ?? -1)) {
      active = { href: item.href, length: path.length };
    }
  }
  return active?.href;
}
