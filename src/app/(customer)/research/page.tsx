import { Database, FileSearch, Hammer, ShieldAlert } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

// The competitor-research surface is being rebuilt on top of the new Hermes-driven
// research engine. The old public.* schema and adapters were ripped on
// feature/hermes-research-engine. This page renders an empty-state shell until the
// research.v_* curated views are live and Hermes has produced its first ingestions.
//
// See docs/research-engine/README.md for the architecture and current build state.
export default async function ResearchPage() {
  await requirePageSurfaceAccess("monitor");

  return (
    <main className="content">
      <PageHeading
        eyebrow="Competitor intelligence"
        title="Research"
        description="The research engine is being rebuilt on Hermes + Apify, writing to the new research.* schema. Live coverage will return once Hermes is deployed and the first WA postcodes are ingested."
      />

      <section className="grid cols-4">
        <MetricCard icon={Database} label="Agents tracked" value="0" note="Pending Hermes census skill" />
        <MetricCard icon={FileSearch} label="Active ads observed" value="0" note="Pending Apify ingestion" />
        <MetricCard icon={Hammer} label="Build phase" value="1 / 10" note="Schema + zod + skill stubs" />
        <MetricCard icon={ShieldAlert} label="Coverage defects" value="0" note="Hermes coverage auditor offline" />
      </section>

      <section className="panel">
        <h2>Build status</h2>
        <p>
          The Hermes research engine collects every Australian real-estate ad and the agents running them. It
          discovers new agents from licence registers, resolves their Meta pages, pulls active ads through
          Apify, classifies copy and style, and runs weekly coverage audits so nothing is silently missed.
        </p>
        <ul>
          <li>
            <StatusPill tone="blue">in progress</StatusPill> Phase 1 — research.* schema, zod schemas,
            curated views, Hermes skill stubs.
          </li>
          <li>
            <StatusPill tone="amber">queued</StatusPill> Phase 2 — Apify account, actor selection, first
            ingestion test against 10 WA advertisers.
          </li>
          <li>
            <StatusPill tone="amber">queued</StatusPill> Phase 3 — Hostinger VPS, Coolify, Cloudflare Access
            for the Hermes deployment.
          </li>
        </ul>
        <p>
          Track progress on the <code>feature/hermes-research-engine</code> branch. The runbook lives at
          <code> docs/research-engine/README.md</code>.
        </p>
      </section>
    </main>
  );
}
