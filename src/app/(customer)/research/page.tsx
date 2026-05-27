import { Camera, FileSearch, ShieldAlert, Target } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { competitorSignals, workspace } from "@/lib/product/demo-data";
import { getComplianceDemo } from "@/lib/product/workflow-data";

export default function ResearchPage() {
  const complianceExamples = getComplianceDemo();

  return (
    <main className="content">
      <PageHeading
        eyebrow="Competitor intelligence"
        title="Research"
        description="Watch competitor patterns, capture permitted public evidence, classify hooks and offers, and keep compliance risk visible before ideas become campaigns."
      />

      <section className="grid cols-4">
        <MetricCard icon={Target} label="Watchlist" value="12" note={`Focused on ${workspace.suburbs.length} service suburbs`} />
        <MetricCard icon={Camera} label="Captures" value="46" note="Screenshots and landing captures stored as artifacts" />
        <MetricCard icon={FileSearch} label="Classified" value="39" note="Hook, offer, CTA, creative type, suburb relevance" />
        <MetricCard icon={ShieldAlert} label="Risk flags" value="7" note="Unsupported claims and targeting issues" />
      </section>

      <section className="panel">
        <h2>Observed Patterns</h2>
        <div className="grid cols-3">
          {competitorSignals.map((signal) => (
            <article className="item-card" key={signal.competitor}>
              <h3>{signal.competitor}</h3>
              <p>{signal.signal}</p>
              <p className="item-meta">{signal.evidence}</p>
              <StatusPill tone="blue">confidence {signal.confidence}</StatusPill>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Compliance Classifier</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Example</th>
              <th>Copy</th>
              <th>Status</th>
              <th>Findings</th>
            </tr>
          </thead>
          <tbody>
            {complianceExamples.map((example) => (
              <tr key={example.label}>
                <td>{example.label}</td>
                <td>{example.copy}</td>
                <td>
                  <StatusPill tone={example.result.status === "approved" ? "green" : "rose"}>
                    {example.result.status}
                  </StatusPill>
                </td>
                <td>{example.result.findings.map((finding) => finding.code).join(", ") || "None"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
