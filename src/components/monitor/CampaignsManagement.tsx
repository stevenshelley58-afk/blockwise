"use client";

import { Fragment, useMemo, useState } from "react";

import { AlertTriangle, Check, ChevronRight, ImageOff, Loader2 } from "lucide-react";

import { formatCurrency } from "@/lib/meta-monitor/calculations";
import type { MetaAdPerformance, MetaAdStatus } from "@/lib/meta-monitor/types";

const MANAGE_API = "/api/integrations/meta/manage";

type ManageTarget = { campaignId?: string; adSetIds?: string[]; adIds?: string[] };

type AdsetGroup = { id: string; name: string; ads: MetaAdPerformance[] };
type CampaignGroup = { id: string; name: string; adsets: AdsetGroup[] };

function deriveStatus(ads: MetaAdPerformance[]): MetaAdStatus {
  return ads.some((ad) => ad.status === "ACTIVE") ? "ACTIVE" : "PAUSED";
}

function groupCampaigns(ads: MetaAdPerformance[]): CampaignGroup[] {
  const campaigns = new Map<string, { name: string; adsets: Map<string, AdsetGroup> }>();

  for (const ad of ads) {
    const campaignId = ad.campaignId || "unknown-campaign";
    const adsetId = ad.adsetId || "unknown-adset";
    const campaign = campaigns.get(campaignId) ?? { name: ad.campaignName || "Meta campaign", adsets: new Map() };
    const adset = campaign.adsets.get(adsetId) ?? { id: adsetId, name: ad.adsetName || "Ad set", ads: [] };
    adset.ads.push(ad);
    campaign.adsets.set(adsetId, adset);
    campaigns.set(campaignId, campaign);
  }

  return Array.from(campaigns.entries()).map(([id, value]) => ({
    id,
    name: value.name,
    adsets: Array.from(value.adsets.values()),
  }));
}

function sumMetrics(ads: MetaAdPerformance[]) {
  return ads.reduce(
    (acc, ad) => ({
      spend: acc.spend + ad.metrics.spend,
      leads: acc.leads + ad.metrics.leads,
      validLeads: acc.validLeads + ad.metrics.validLeads,
    }),
    { spend: 0, leads: 0, validLeads: 0 },
  );
}

function cpl(spend: number, leads: number): string {
  return leads > 0 ? formatCurrency(spend / leads) : "—";
}

function StatusPill({ status }: { status: MetaAdStatus }) {
  const active = status === "ACTIVE";
  return <span className={`mm-pill ${active ? "green" : "neutral"}`}>{active ? "Active" : "Paused"}</span>;
}

function RowAction({ target, status }: { target: ManageTarget; status: MetaAdStatus }) {
  type Phase = "idle" | "confirm" | "pushing" | "done" | "error";
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [localStatus, setLocalStatus] = useState<MetaAdStatus>(status);
  const action = localStatus === "ACTIVE" ? "pause" : "activate";

  async function poll(mutationId: string): Promise<{ status: string; lastError: string | null }> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 600 : 1200));
      const res = await fetch(`${MANAGE_API}?mutationId=${encodeURIComponent(mutationId)}`, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json().catch(() => ({}));
      const next = data.mutation?.status as string | undefined;
      if (next === "applied" || next === "failed") {
        return { status: next, lastError: (data.mutation?.lastError as string | null) ?? null };
      }
    }
    return { status: "applying", lastError: null };
  }

  async function run() {
    setPhase("pushing");
    try {
      const createRes = await fetch(MANAGE_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...target }),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) throw new Error(created.error ?? "Could not create the change.");
      const approvalId = created.mutation?.approvalRequestId as string | undefined;
      const mutationId = created.mutation?.mutationId as string | undefined;
      if (!approvalId || !mutationId) throw new Error("Unexpected response.");

      const approveRes = await fetch(`/api/approvals/${approvalId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      if (!approveRes.ok) {
        const err = await approveRes.json().catch(() => ({}));
        throw new Error(err.error ?? "Approval could not be queued.");
      }

      const final = await poll(mutationId);
      if (final.status === "applied") {
        setLocalStatus(action === "pause" ? "PAUSED" : "ACTIVE");
        setMessage(action === "pause" ? "Paused" : "Resumed");
        setPhase("done");
      } else if (final.status === "failed") {
        setMessage(final.lastError ?? "Meta rejected the change.");
        setPhase("error");
      } else {
        setMessage("Applying…");
        setPhase("done");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
      setPhase("error");
    }
  }

  if (phase === "pushing") {
    return (
      <span className="rx-state rx-state-pushing">
        <Loader2 size={12} className="mm-spin" aria-hidden /> Pushing…
      </span>
    );
  }
  if (phase === "done") {
    return (
      <span className="rx-state rx-state-done">
        <Check size={12} aria-hidden /> {message}
      </span>
    );
  }
  if (phase === "error") {
    return (
      <button type="button" className="rx-btn" title={message} onClick={() => setPhase("idle")}>
        <AlertTriangle size={12} aria-hidden /> Retry
      </button>
    );
  }
  if (phase === "confirm") {
    return (
      <span className="rx-confirm">
        <button type="button" className="rx-btn rx-btn-primary" onClick={run}>
          Approve
        </button>
        <button type="button" className="rx-btn" onClick={() => setPhase("idle")}>
          Cancel
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`rx-btn ${action === "pause" ? "rx-btn-danger" : ""}`}
      onClick={() => setPhase("confirm")}
    >
      {action === "pause" ? "Pause" : "Resume"}
    </button>
  );
}

function Thumb({ ad }: { ad: MetaAdPerformance }) {
  const src = ad.creative.thumbnailUrl ?? ad.creative.imageUrl ?? ad.creative.videoThumbnailUrl;
  if (src) {
    // Meta CDN thumbnails are short-lived signed URLs; plain img keeps them valid.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="rx-thumb" src={src} alt="" width={28} height={28} loading="lazy" />;
  }
  return (
    <span className="rx-thumb rx-thumb-empty" aria-hidden>
      <ImageOff size={12} />
    </span>
  );
}

export function CampaignsManagement({
  ads,
  onSelectAd,
}: {
  ads: MetaAdPerformance[];
  onSelectAd: (adId: string) => void;
}) {
  const campaigns = useMemo(() => groupCampaigns(ads), [ads]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(campaigns.slice(0, 1).map((c) => c.id)));

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (campaigns.length === 0) return null;

  return (
    <section className="rx-campaigns">
      <div className="rx-camp-head">
        <h3>Campaigns</h3>
        <p>Expand to manage ad sets and ads. Pause and resume apply straight to Meta.</p>
      </div>
      <div className="rx-card">
        <table className="rx-table">
          <thead>
            <tr>
              <th className="rx-left">Campaign / ad set / ad</th>
              <th>Status</th>
              <th>Spend</th>
              <th>Leads</th>
              <th>Valid</th>
              <th>CPL</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => {
              const campaignAds = campaign.adsets.flatMap((s) => s.ads);
              const ct = sumMetrics(campaignAds);
              const isOpen = open.has(campaign.id);
              return (
                <CampaignRows
                  key={campaign.id}
                  campaign={campaign}
                  campaignAds={campaignAds}
                  totals={ct}
                  isOpen={isOpen}
                  onToggle={() => toggle(campaign.id)}
                  onSelectAd={onSelectAd}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CampaignRows({
  campaign,
  campaignAds,
  totals,
  isOpen,
  onToggle,
  onSelectAd,
}: {
  campaign: CampaignGroup;
  campaignAds: MetaAdPerformance[];
  totals: { spend: number; leads: number; validLeads: number };
  isOpen: boolean;
  onToggle: () => void;
  onSelectAd: (adId: string) => void;
}) {
  return (
    <>
      <tr className="rx-camp-row" onClick={onToggle}>
        <td className="rx-left">
          <ChevronRight size={13} className={`rx-chev ${isOpen ? "rx-chev-open" : ""}`} aria-hidden />
          <span className="rx-name">{campaign.name}</span>
        </td>
        <td><StatusPill status={deriveStatus(campaignAds)} /></td>
        <td>{formatCurrency(totals.spend)}</td>
        <td>{totals.leads}</td>
        <td>{totals.validLeads}</td>
        <td>{cpl(totals.spend, totals.leads)}</td>
        <td onClick={(e) => e.stopPropagation()}>
          <div className="rx-actions">
            <RowAction target={{ campaignId: campaign.id }} status={deriveStatus(campaignAds)} />
          </div>
        </td>
      </tr>
      {isOpen
        ? campaign.adsets.map((adset) => {
            const st = sumMetrics(adset.ads);
            return (
              <Fragment key={adset.id}>
                <tr className="rx-sub-row">
                  <td className="rx-left rx-indent1"><span className="rx-name rx-muted">{adset.name}</span></td>
                  <td><StatusPill status={deriveStatus(adset.ads)} /></td>
                  <td>{formatCurrency(st.spend)}</td>
                  <td>{st.leads}</td>
                  <td>{st.validLeads}</td>
                  <td>{cpl(st.spend, st.leads)}</td>
                  <td>
                    <div className="rx-actions">
                      <RowAction target={{ adSetIds: [adset.id] }} status={deriveStatus(adset.ads)} />
                    </div>
                  </td>
                </tr>
                {adset.ads.map((ad) => (
                  <tr key={ad.adId} className="rx-ad-row">
                    <td className="rx-left rx-indent2">
                      <button type="button" className="rx-ad-name-btn" onClick={() => onSelectAd(ad.adId)}>
                        <Thumb ad={ad} />
                        <span className="rx-muted">{ad.adName}</span>
                        {ad.fatigued ? <span className="rx-tag rx-tag-fatigue">Fatigue</span> : null}
                      </button>
                    </td>
                    <td><StatusPill status={ad.status} /></td>
                    <td>{formatCurrency(ad.metrics.spend)}</td>
                    <td>{ad.metrics.leads}</td>
                    <td>{ad.metrics.validLeads}</td>
                    <td>{cpl(ad.metrics.spend, ad.metrics.leads)}</td>
                    <td>
                      <div className="rx-actions">
                        <RowAction target={{ adIds: [ad.adId] }} status={ad.status} />
                      </div>
                    </td>
                  </tr>
                ))}
              </Fragment>
            );
          })
        : null}
    </>
  );
}
