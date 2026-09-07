import type { Metadata } from "next";
import { OutboundReportView } from "@/components/outbound-report/report-view";
import { buildDemoOutreachReport } from "@/lib/outreach/fixtures";
import { previewSegment } from "@/lib/outreach/preview-options";
import "@/components/outbound-report/report-view.css";
export const metadata: Metadata = { title: "Local ad report preview", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function DemoReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <OutboundReportView report={buildDemoOutreachReport(previewSegment(params.segment))} isPreview signupHref="/signup?source=outbound-report" />;
}
