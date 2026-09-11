import type { Metadata } from "next";
import { after } from "next/server";

import { HomepageConcept } from "@/components/homepage-concept/homepage-concept";

import "./concept/concept.css";
import "@/components/homepage-concept/hero-ad-showcase.css";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = (await searchParams) ?? {};
  const keys = Object.keys(params);
  if (keys.length > 0) {
    // A provider callback should never land on the marketing page. If it does,
    // record what arrived so the redirect target can be traced.
    after(() => {
      console.error(`home route received query params: ${keys.join(",")}`);
    });
  }

  return <HomepageConcept />;
}
