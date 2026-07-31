import { Images, ScanSearch } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { TraceListTable } from "@/components/template-trace/trace-list";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listTemplateTraces } from "@/lib/operator/template-trace";

export const dynamic = "force-dynamic";

export default async function TemplateTraceListPage() {
  await requirePageSurfaceAccess("operator");
  const templates = listTemplateTraces();

  const feedCount = templates.filter((t) => t.format === "4:5").length;
  const storyCount = templates.filter((t) => t.format === "9:16").length;
  const intentSet = new Set(templates.map((t) => t.classification.primary_intent));

  return (
    <main className="content">
      <PageHeading
        eyebrow="AdStudio QA"
        title="Template Trace Inspector"
        description="Inspect the full clone pipeline for every template: source ad, sample, prompt, regions, and inputs. Click a row to open the template and see the trace, regions, and regenerate."
      />

      <section className="grid cols-4" aria-label="Template trace metrics">
        <MetricCard icon={Images} label="Templates" value={String(templates.length)} note="Approved gallery templates" />
        <MetricCard icon={Images} label="Feed (4:5)" value={String(feedCount)} note="Portrait feed ads" />
        <MetricCard icon={Images} label="Story (9:16)" value={String(storyCount)} note="Vertical story/reel ads" />
        <MetricCard icon={ScanSearch} label="Intents" value={String(intentSet.size)} note={[...intentSet].join(", ")} />
      </section>

      <section className="panel">
        <h2>All Templates</h2>
        <TraceListTable templates={templates} />
      </section>
    </main>
  );
}
