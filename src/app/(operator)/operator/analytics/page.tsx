import { SiteAnalyticsDashboard } from "@/components/operator/site-analytics-dashboard";
import { PageHeading } from "@/components/page-heading";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function OperatorSiteAnalyticsPage() {
  await requirePageSurfaceAccess("operator");

  return (
    <main className="content">
      <PageHeading
        eyebrow="Internal control plane"
        title="Site Analytics"
        description="First-party traffic across the marketing site and customer app: visitors, page views, referrers, devices, and countries. Operator surfaces are excluded; bots are filtered."
      />
      <div className="operator-analytics-surface">
        <SiteAnalyticsDashboard />
      </div>
    </main>
  );
}
