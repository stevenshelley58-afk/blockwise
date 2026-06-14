import { ArrowRight, ChartNoAxesCombined, Radar, UsersRound } from "lucide-react";
import Link from "next/link";

import { ConfirmRegistrationTracker } from "@/components/confirm-registration-tracker";
import { PageHeading } from "@/components/page-heading";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function SelfServePage() {
  await requirePageSurfaceAccess("self_serve");

  return (
    <main className="content">
      <ConfirmRegistrationTracker />
      <PageHeading
        title="Turn a listing into ads"
        description="One photo and a short brief — that's all it takes."
        actions={
          <Link className="button big" href="/ad-studio?first=1">
            Create an ad
            <ArrowRight aria-hidden size={16} />
          </Link>
        }
      />

      <section className="grid cols-3" aria-label="Explore">
        <Link className="item-card" href="/ad-radar">
          <Radar aria-hidden color="#123e75" size={20} />
          <h3>Ad Spy</h3>
          <p className="item-meta">See ads competitors are running.</p>
        </Link>
        <Link className="item-card" href="/results">
          <ChartNoAxesCombined aria-hidden color="#123e75" size={20} />
          <h3>Performance</h3>
          <p className="item-meta">Track how your ads are doing.</p>
        </Link>
        <Link className="item-card" href="/leads">
          <UsersRound aria-hidden color="#123e75" size={20} />
          <h3>Leads</h3>
          <p className="item-meta">Enquiries your ads bring in.</p>
        </Link>
      </section>
    </main>
  );
}
