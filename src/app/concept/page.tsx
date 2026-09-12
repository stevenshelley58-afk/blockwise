import type { Metadata } from "next";

import { HomepageConcept } from "@/components/homepage-concept/homepage-concept";

import "./concept.css";
import "@/components/homepage-concept/hero-ad-showcase.css";

export const metadata: Metadata = {
  title: { absolute: "More leads. Less ad management. | Blockwise" },
  description: "Create, customise and run Facebook and Instagram ads in one place.",
  keywords: ["real estate ads", "real estate lead generation", "Facebook ads", "Instagram ads"],
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
