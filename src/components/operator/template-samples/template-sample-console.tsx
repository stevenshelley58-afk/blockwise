"use client";

import { useState } from "react";

import type { CreativeSkeleton } from "@/lib/ad-template-library/skeleton";

export type SampleImportView = {
  id: string;
  templateKey: string;
  status: string;
  sampleAssetUrl: string;
  skeleton: CreativeSkeleton;
};

type Props = {
  imports: SampleImportView[];
  workspaceId: string;
};

const ROLE_COLOURS: Record<string, string> = {
  primary: "#22c55e",
  secondary: "#38bdf8",
  agent_headshot: "#f59e0b",
};

export function TemplateSampleConsole({ imports, workspaceId }: Props) {
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(imports.map((item) => [item.id, item.status])),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function act(item: SampleImportView, action: "approve" | "archive") {
    setBusyId(item.id);
    setErrors((prev) => ({ ...prev, [item.id]: "" }));
    try {
      const res = await fetch(`/api/adstudio/template-library?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, templateKey: item.templateKey }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(typeof payload.error === "string" ? payload.error : `Request failed (${res.status}).`);
      }
      setStatuses((prev) => ({ ...prev, [item.id]: action === "approve" ? "approved" : "archived" }));
    } catch (error) {
      setErrors((prev) => ({ ...prev, [item.id]: error instanceof Error ? error.message : "Action failed." }));
    } finally {
      setBusyId(null);
    }
  }

  if (imports.length === 0) {
    return (
      <p className="muted">
        No sample imports yet. POST an image to <code>/api/adstudio/template-sample-import</code> to extract a draft
        template from a sample creative.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      {imports.map((item) => {
        const status = statuses[item.id] ?? item.status;
        const frames = item.skeleton.composition.image_frames ?? [];
        const zones = item.skeleton.composition.copy_safe_zones;
        return (
          <article
            key={item.id}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(180px, 280px) 1fr",
              gap: "1.5rem",
              border: "1px solid var(--border, #2a2a2a)",
              borderRadius: 12,
              padding: "1rem",
              alignItems: "start",
            }}
          >
            <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 5", background: "#0c0c0c", borderRadius: 8, overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.sampleAssetUrl} alt="Sample creative" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              <svg
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
              >
                {frames.map((frame) => (
                  <rect
                    key={`f-${frame.id}`}
                    x={frame.x}
                    y={frame.y}
                    width={frame.width}
                    height={frame.height}
                    fill="none"
                    stroke={ROLE_COLOURS[frame.role] ?? "#22c55e"}
                    strokeWidth={0.008}
                  />
                ))}
                {zones.map((zone) => (
                  <rect
                    key={`z-${zone.id}`}
                    x={zone.x}
                    y={zone.y}
                    width={zone.width}
                    height={zone.height}
                    fill="rgba(168,85,247,0.12)"
                    stroke="#a855f7"
                    strokeWidth={0.005}
                    strokeDasharray="0.02 0.01"
                  />
                ))}
              </svg>
            </div>

            <div style={{ display: "grid", gap: "0.5rem" }}>
              <header style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline" }}>
                <h3 style={{ margin: 0 }}>{item.skeleton.archetype}</h3>
                <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>{status}</span>
              </header>
              <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                {item.templateKey} · confidence {Math.round(item.skeleton.confidence)}
              </p>
              <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 0.75rem", margin: "0.5rem 0", fontSize: "0.85rem" }}>
                <dt style={{ opacity: 0.7 }}>Hook</dt>
                <dd style={{ margin: 0 }}>{item.skeleton.copy.hook_style}</dd>
                <dt style={{ opacity: 0.7 }}>Headline</dt>
                <dd style={{ margin: 0 }}>{item.skeleton.copy.headline_pattern}</dd>
                <dt style={{ opacity: 0.7 }}>CTA</dt>
                <dd style={{ margin: 0 }}>{item.skeleton.copy.cta}</dd>
                <dt style={{ opacity: 0.7 }}>Slots</dt>
                <dd style={{ margin: 0 }}>{frames.map((frame) => frame.role).join(", ") || "full-bleed"}</dd>
                <dt style={{ opacity: 0.7 }}>Variables</dt>
                <dd style={{ margin: 0 }}>{item.skeleton.variables.join(", ") || "—"}</dd>
              </dl>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {item.skeleton.color.palette.map((colour) => (
                  <span
                    key={colour}
                    title={colour}
                    style={{ width: 18, height: 18, borderRadius: 4, background: colour, border: "1px solid rgba(255,255,255,0.2)" }}
                  />
                ))}
              </div>
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
                <button type="button" disabled={busyId === item.id || status === "approved"} onClick={() => act(item, "approve")}>
                  {status === "approved" ? "Approved" : "Approve → Library"}
                </button>
                <button type="button" disabled={busyId === item.id || status === "archived"} onClick={() => act(item, "archive")}>
                  Archive
                </button>
              </div>
              {errors[item.id] ? <p style={{ color: "#f87171", margin: 0, fontSize: "0.8rem" }}>{errors[item.id]}</p> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
