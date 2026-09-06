import type { Metadata } from "next";

import { HomepageConcept } from "@/components/homepage-concept/homepage-concept";

import "./concept.css";

export const metadata: Metadata = {
  title: "Homepage concept",
  description: "A Blockwise homepage concept preview.",
  other: {
    "blockwise-preview-revision": process.env.BLOCKWISE_BUILD_REVISION ?? "",
  },
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export const dynamic = "force-static";

export default function ConceptPage() {
  return <HomepageConcept />;
}
