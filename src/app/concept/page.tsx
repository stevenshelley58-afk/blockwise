import type { Metadata } from "next";

import { HomepageConcept } from "@/components/homepage-concept/homepage-concept";

import "./concept.css";

export const metadata: Metadata = {
  title: "More leads. Less ad management. | Blockwise",
  description: "Create, review and run real-estate Feed and Story ads with Blockwise.",
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
