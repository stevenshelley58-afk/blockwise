"use client";

import Link from "next/link";

/**
 * C5 fix: "Log in" nav link that prevents Space-key activation.
 *
 * On the public landing page, pressing Space/PageDown is expected to scroll
 * the page. Standard <a> and Next.js <Link> elements intercept the Space key
 * when focused, navigating instead of scrolling. This component suppresses
 * that behaviour so Space scrolls the viewport while Enter and click still
 * navigate to /login as expected.
 */
export function SignInLink() {
  return (
    <Link
      href="/login"
      onKeyDown={(e) => {
        if (e.key === " ") {
          // Let the browser scroll the page instead of following the link.
          e.preventDefault();
        }
      }}
    >
      Log in
    </Link>
  );
}
