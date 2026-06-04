import { ClipboardCheck, FileText, Image, Search, WandSparkles } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { campaignIdeas, competitorSignals } from "@/lib/product/demo-data";

export const dynamic = "force-dynamic";

export default async function SelfServePage() {
  await requirePageSurfaceAccess("self_serve");

  return (
    <main className="content">
      <PageHeading
        eyebrow="Customer product"
        title="Self-Serve"
        description="Research competitors, mine campaign ideas, draft Meta and Google campaigns, create AI creative, preview ads, and manage leads under approval gates."
      />

      <section className="grid cols-4" aria-label="Self-serve workflow">
        <MetricCard icon={Search} label="Competitors" value="12" note="Watchlisted with source evidence" />
        <MetricCard icon={WandSparkles} label="Ideas" value="34" note="Generated from patterns and owned results" />
        <MetricCard icon={Image} label="Creative Drafts" value="18" note="Image cost controls enabled" />
        <MetricCard icon={ClipboardCheck} label="Approvals" value="5" note="Publishing is blocked until reviewed" />
      </section>

      <section className="split">
        <div className="panel">
          <h2>Idea Mine</h2>
          <div className="stack">
            {campaignIdeas.map((idea) => (
              <article className="item-card" key={idea.title}>
                <h3>{idea.title}</h3>
                <p>{idea.hook}</p>
                <p className="item-meta">{idea.channel}</p>
                <StatusPill tone={idea.approval.includes("Ready") ? "green" : "amber"}>{idea.approval}</StatusPill>
              </article>
            ))}
          </div>
        </div>

        <aside className="ad-preview" aria-label="Ad preview studio">
          <div className="ad-visual">
            <div className="ad-visual-inner">
              <p className="eyebrow">Creative Studio</p>
              <h2 style={{ marginBottom: 6 }}>Suburb appraisal pulse</h2>
              <p className="item-meta">AI draft image and copy are held for operator/client approval.</p>
            </div>
          </div>
          <div className="ad-copy">
            <h3>Ad Preview Studio</h3>
            <p className="item-meta">
              Preview Meta lead forms, Google search drafts, carousel concepts, lead magnet covers, and compliance flags before publishing.
            </p>
          </div>
        </aside>
      </section>

      <section className="panel">
        <h2>Campaign Builder</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Stage</th>
              <th>Output</th>
              <th>Gate</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Competitor Explorer", competitorSignals[0].signal, "Source evidence required"],
              ["Creative Brief", "Image prompts, carousel outline, and lead magnet cover brief", "Brand-safe review"],
              ["Compliance Check", "AU real-estate claim, housing targeting, urgency, and unsupported performance checks", "Human approval required"],
              ["Provider Draft", "Meta lead ad and Google Search campaign payloads", "Publishing blocked"],
            ].map(([stage, output, gate]) => (
              <tr key={stage}>
                <td>{stage}</td>
                <td>{output}</td>
                <td>{gate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Lead Magnet Builder</h2>
        <div className="grid cols-3">
          {["Seller suburb report", "Downsizer checklist", "Renovate or sell calculator"].map((asset) => (
            <article className="item-card" key={asset}>
              <FileText aria-hidden color="#2364aa" size={20} />
              <h3>{asset}</h3>
              <p className="item-meta">Drafted by AI, stored as a reviewable campaign asset, and linked to lead source attribution.</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
