import { redirect } from "next/navigation";

import { HOME_PATH } from "@/lib/auth/home";

// Legacy signed-in landing URL, kept because installed PWAs and older links
// still open it. It resolves to a constant, so it performs no data access
// before redirecting; the real auth gate runs on the destination route. It was
// force-dynamic, which bought nothing: the target is a build-time constant, so
// the route is prerendered as a static redirect instead of re-rendering per hit.
export default function HomeRedirectPage() {
  redirect(HOME_PATH);
}
