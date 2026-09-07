import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmailLibrary } from "@/components/email-design/email-library";
export const metadata: Metadata = { title: "Blockwise email library", robots: { index: false, follow: false } };
export default function EmailLibraryPage() {
  if (process.env.BLOCKWISE_EMAIL_PREVIEW !== "true") notFound();
  return <EmailLibrary />;
}
