/**
 * The signed-in landing destination.
 *
 * Every authenticated profile lands on the self-serve dashboard; operator
 * management has moved to frank.fail. This is deliberately a constant and not
 * a lookup: resolving it used to make an auth round trip inside the /home
 * redirect, which meant an authenticated visit paid two server renders and two
 * auth calls to arrive at a URL that could never be anything else. The auth
 * gate that matters is AppShell's, which runs on the destination route.
 */
export const HOME_PATH = "/self-serve";
