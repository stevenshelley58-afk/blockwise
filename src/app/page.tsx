import type { Metadata } from "next";

import { HomepageConcept } from "@/components/homepage-concept/homepage-concept";

import "./concept/concept.css";
import "@/components/homepage-concept/hero-ad-showcase.css";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return <HomepageConcept />;
}
