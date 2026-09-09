import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmailLibrary } from "@/components/email-design/email-library";
export const metadata: Metadata = { title: "Daily, weekly and new-lead emails", robots: { index: false, follow: false } };
export default function EmailNotificationsPage() {
  if (process.env.BLOCKWISE_EMAIL_PREVIEW !== "true") notFound();
  return <EmailLibrary notificationsOnly />;
}
