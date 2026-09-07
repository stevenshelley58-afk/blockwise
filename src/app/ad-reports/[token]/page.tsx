import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OutboundReportView } from "@/components/outbound-report/report-view";
import { loadPublicOutreachReport } from "@/lib/outreach/repository";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import "@/components/outbound-report/report-view.css";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Local advertising report", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function AdReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) notFound();
  const report = await loadPublicOutreachReport(createSupabaseServiceClient(), token);
  if (!report) notFound();
  return <OutboundReportView report={report} signupHref="/signup?source=outbound-report" />;
}
