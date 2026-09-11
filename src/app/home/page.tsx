import { redirect } from "next/navigation";

import { HOME_PATH } from "@/lib/auth/home";

export const dynamic = "force-dynamic";

// Legacy signed-in landing URL, kept because installed PWAs and older links
// still open it. It resolves to a constant, so it performs no data access
// before redirecting; the real auth gate runs on the destination route.
export default function HomeRedirectPage() {
  redirect(HOME_PATH);
}
