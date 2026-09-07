import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmailDesignStudio } from "@/components/email-design/email-design-studio";

export const metadata: Metadata = {
  title: "Email design preview",
  robots: { index: false, follow: false },
};

export default function EmailDesignPage() {
  if (process.env.BLOCKWISE_EMAIL_PREVIEW !== "true") notFound();
  return <EmailDesignStudio />;
}
