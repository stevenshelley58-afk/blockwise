"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, Circle, Download, Send, Trash2 } from "lucide-react";

import { PanelHeader } from "../inspector";

type ReadinessEntry = {
  label: string;
  met: boolean;
};

type PublishSetupPanelProps = {
  campaignId: string;
  destinationUrl: string;
  onExport: () => void;
  onDelete?: () => void;
};

export function PublishSetupPanel({ campaignId, destinationUrl, onExport, onDelete }: PublishSetupPanelProps) {
  const [readiness, setReadiness] = useState<ReadinessEntry[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishDone, setPublishDone] = useState(false);

  // M1: fetch readiness from the existing endpoint
  useEffect(() => {
    if (!campaignId) return;
    fetch(`/api/adstudio/publish-readiness?campaignId=${encodeURIComponent(campaignId)}`)
      .then((res) => res.json().catch(() => null))
      .then((data) => {
        if (!data) return;
        // Normalise: the endpoint may return { items: [...] } or an array directly
        const items: Array<{ label: string; met: boolean }> = Array.isArray(data)
          ? data
          : Array.isArray(data.items)
            ? data.items
            : [];
        setReadiness(items);
      })
      .catch(() => {});
  }, [campaignId]);

  const allMet = readiness ? readiness.every((item) => item.met) : false;

  // M1: live publish gated behind readiness
  async function handlePublishLive() {
    if (!allMet) return;
    setPublishing(true);
    setPublishError("");
    try {
      const res = await fetch(`/api/adstudio/export-packages/${campaignId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      <PanelHeader title="Export" detail="Download your creatives or publish live when all checks pass." />

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

      {/* Destination confirmation */}
      {destinationUrl && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
          <span style={{ color: "var(--muted)" }}>Destination</span>
          <strong style={{ display: "block", marginTop: 2, wordBreak: "break-all" }}>{destinationUrl}</strong>
        </div>
      )}

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
            {publishing ? "Publishing…" : "Publish live"}
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
