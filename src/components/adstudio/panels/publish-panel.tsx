"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, Download, Send, Trash2 } from "lucide-react";

import type { AdStudioCampaignPack } from "@/lib/adstudio";
import type { MetaPublishControls } from "@/lib/providers/meta-execution";

import { PanelHeader } from "../inspector";

type ReadinessEntry = {
  id?: string;
  label: string;
  met: boolean;
  automatic?: boolean;
};

type PublishSetupPanelProps = {
  campaignId: string;
  campaignPack: AdStudioCampaignPack;
  destinationUrl: string;
  onExport: () => void;
  onDelete?: () => void;
};

export function PublishSetupPanel({ campaignId, campaignPack, destinationUrl, onExport, onDelete }: PublishSetupPanelProps) {
  const [readiness, setReadiness] = useState<ReadinessEntry[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishDone, setPublishDone] = useState(false);
  const [dailyBudgetAud, setDailyBudgetAud] = useState(20);
  const [durationDays, setDurationDays] = useState(7);

  // M1: fetch readiness from the existing endpoint
  useEffect(() => {
    if (!campaignId) return;
    fetch(`/api/adstudio/publish-readiness?campaignId=${encodeURIComponent(campaignId)}`)
      .then((res) => res.json().catch(() => null))
      .then((data) => {
        if (!data) return;
        const source = Array.isArray(data)
          ? data
          : Array.isArray(data.items)
            ? data.items
            : Array.isArray(data.checklist)
              ? data.checklist
              : [];
        const items: ReadinessEntry[] = source.map((item: { id?: string; label: string; met?: boolean; done?: boolean; automatic?: boolean }) => ({
          id: item.id,
          label: item.label,
          met: item.met ?? Boolean(item.done),
          automatic: item.automatic,
        }));
        setReadiness(items);
      })
      .catch(() => {});
  }, [campaignId]);

  const allMet = readiness ? readiness.every((item) => item.met) : false;

  function buildControls(): MetaPublishControls {
    const now = new Date();
    const end = new Date(now);
    end.setDate(now.getDate() + durationDays);
    return {
      dailyBudgetMinorUnits: Math.max(1, Math.round(dailyBudgetAud * 100)),
      geo: {
        type: "country",
        country: campaignPack.campaign.market.country,
      },
      schedule: {
        startTime: now.toISOString(),
        endTime: end.toISOString(),
      },
      placements: {
        publisherPlatforms: ["facebook", "instagram"],
        facebookPositions: [],
        instagramPositions: [],
      },
    };
  }

  // M1: live publish gated behind readiness
  async function handlePublishLive() {
    if (!allMet) return;
    setPublishing(true);
    setPublishError("");
    try {
      const res = await fetch(`/api/adstudio/export-packages/${campaignId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignPack,
          controls: buildControls(),
          requestApproval: true,
          dryRun: false,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Publish failed." }));
        throw new Error(body.error ?? "Publish failed.");
      }
      setPublishDone(true);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      {/* M1: title is "Export" — the download action is the manual export */}
      <PanelHeader title="Publish" detail="Check readiness, export creatives, or publish live." />

      {/* M1: Readiness section */}
      {readiness && (
        <section style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 14, display: "grid", gap: 10 }}>
          <strong style={{ fontSize: 13, fontWeight: 750 }}>Publish readiness</strong>
          {readiness.map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              {item.met
                ? <Check size={14} style={{ color: "#45b757", flexShrink: 0 }} aria-hidden />
                : <CircleAlert size={14} style={{ color: "#ffb020", flexShrink: 0 }} aria-hidden />}
              <span style={{ color: item.met ? "var(--ink)" : "var(--muted)" }}>{item.label}</span>
            </div>
          ))}
        </section>
      )}

      <section style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
        <span style={{ color: "var(--muted)" }}>Audience and location</span>
        <strong style={{ display: "block", marginTop: 2 }}>Recommended local audience</strong>
        <span style={{ display: "block", marginTop: 4, color: "var(--muted)" }}>
          {campaignPack.campaign.market.suburb}, {campaignPack.campaign.market.state}
        </span>
      </section>

      {/* Destination confirmation */}
      {destinationUrl && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>Destination</span>
          <strong style={{ display: "block", marginTop: 2, wordBreak: "break-all" }}>{destinationUrl}</strong>
        </div>
      )}

      <section style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 14, display: "grid", gap: 12 }}>
        <strong style={{ fontSize: 13, fontWeight: 750 }}>Budget and duration</strong>
        <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>
          Daily budget
          <select value={dailyBudgetAud} onChange={(event) => setDailyBudgetAud(Number(event.target.value))}>
            <option value={10}>$10/day starter</option>
            <option value={20}>$20/day recommended</option>
            <option value={50}>$50/day stronger test</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>
          Duration
          <select value={durationDays} onChange={(event) => setDurationDays(Number(event.target.value))}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
        </label>
      </section>

      {/* M1: Export (manual download) button — always the primary action */}
      <button className="studio-btn secondary block" type="button" onClick={onExport}>
        <Download aria-hidden size={17} />
        Export creatives
      </button>

      {/* M1: Publish live — gated behind readiness */}
      {publishDone ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderRadius: 8, background: "#edf8f0", color: "#126b35", border: "1px solid #cdebd4", fontWeight: 750 }}>
          <Check size={16} aria-hidden />
          Published live
        </div>
      ) : (
        <>
          {publishError && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fff2f2", color: "#b91c1c", border: "1px solid #ffd5d5", fontSize: 13, fontWeight: 700 }}>
              {publishError}
            </div>
          )}
          <button
            className="studio-btn publish block"
            type="button"
            disabled={!allMet || publishing}
            onClick={handlePublishLive}
          >
            <Send aria-hidden size={17} />
            {publishing ? "Publishing..." : "Publish live"}
          </button>
          {readiness && !allMet && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
              Resolve all readiness items above to enable live publishing.
            </p>
          )}
        </>
      )}

      {/* H9: Delete campaign — danger zone at the bottom of publish panel */}
      {onDelete && (
        <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <button
            type="button"
            style={{
              width: "100%",
              border: "1px solid #ffd5d5",
              borderRadius: 8,
              background: "#fff",
              color: "#dc2626",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              minHeight: 40,
              fontWeight: 750,
              fontSize: 13,
              cursor: "pointer",
            }}
            onClick={onDelete}
          >
            <Trash2 aria-hidden size={15} />
            Delete campaign
          </button>
        </div>
      )}
    </>
  );
}
