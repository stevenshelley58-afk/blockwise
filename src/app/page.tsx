import type { Metadata } from "next";

import { HomepageConcept } from "@/components/homepage-concept/homepage-concept";

import "./concept/concept.css";
import "@/components/homepage-concept/hero-ad-showcase.css";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * The marketing homepage is fully static.
 *
 * It previously accepted `searchParams` only to log the query keys, and that
 * single read was enough to make the whole route dynamic: the response came
 * back `private, no-cache, no-store` with no `x-nextjs-cache`, so every visit
 * re-rendered it and an edge cache could never hold it (the Cloudflare cache
 * hit rate for this zone read 0.00%). The diagnostic had no reader and nothing
 * in the app links to `/` with a query string, so it is gone and the route is
 * cacheable again.
 */
export default function HomePage() {
  return <HomepageConcept />;
}
