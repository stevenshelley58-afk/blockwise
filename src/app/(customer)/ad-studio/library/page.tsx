import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Compatibility route for bookmarks from the retired combined library. */
export default function LibraryCompatibilityRedirect() {
  redirect("/ad-studio/ads");
}
