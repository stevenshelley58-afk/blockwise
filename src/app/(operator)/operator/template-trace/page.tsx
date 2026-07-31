import { Images, ScanSearch, Type } from "lucide-react";
import Link from "next/link";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
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
        description="Inspect the full clone pipeline for every template: source ad, sample, prompt, regions, and inputs. Open a template to see the trace and regenerate."
      />

      <section className="grid cols-4" aria-label="Template trace metrics">
        <MetricCard icon={Images} label="Templates" value={String(templates.length)} note="Approved gallery templates" />
        <MetricCard icon={Images} label="Feed (4:5)" value={String(feedCount)} note="Portrait feed ads" />
        <MetricCard icon={Images} label="Story (9:16)" value={String(storyCount)} note="Vertical story/reel ads" />
        <MetricCard icon={ScanSearch} label="Intents" value={String(intentSet.size)} note={[...intentSet].join(", ")} />
      </section>

      <section className="panel">
        <h2>All Templates</h2>
        <table className="table responsive-card-table">
          <thead>
            <tr>
              <th>Sample</th>
              <th>Name</th>
              <th>Format</th>
              <th>Intent</th>
              <th>Focus</th>
              <th>Images</th>
              <th>Text</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td data-label="Sample">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={t.thumbnailSrc}
                    alt={t.name}
                    width={48}
                    height={60}
                    style={{ objectFit: "cover", borderRadius: 4, border: "1px solid var(--border-soft, #333)" }}
                  />
                </td>
                <td data-label="Name">
                  <Link href={`/operator/template-trace/${t.id}`} style={{ color: "var(--accent-strong)", textDecoration: "none", fontWeight: 600 }}>
                    {t.name}
                  </Link>
                  <br />
                  <span style={{ fontSize: 11, opacity: 0.6, fontFamily: "monospace" }}>{t.id}</span>
                </td>
                <td data-label="Format">
                  <StatusPill tone={t.format === "4:5" ? "blue" : "amber"}>{t.format}</StatusPill>
                </td>
                <td data-label="Intent">{t.classification.primary_intent}</td>
                <td data-label="Focus">{t.classification.property_or_agent_focus}</td>
                <td data-label="Images">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Images size={13} /> {t.imageInputCount}
                  </span>
                </td>
                <td data-label="Text">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Type size={13} /> {t.textInputCount}
                  </span>
                </td>
                <td data-label="Source">
                  {t.hasSourceFile ? (
                    <StatusPill tone="green">On disk</StatusPill>
                  ) : (
                    <StatusPill tone="amber">Missing</StatusPill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
