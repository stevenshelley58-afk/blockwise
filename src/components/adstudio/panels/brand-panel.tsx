"use client";

import type { AdStudioBrandKit } from "@/lib/adstudio";

import { FieldShell, PanelHeader } from "../inspector";
import { useBrandKit } from "../use-brand-kit";

type BrandPanelProps = {
  brandKit: AdStudioBrandKit;
  /** @deprecated Derived internally via useBrandKit — kept for caller compatibility */
  brand?: string;
};

export function BrandPanel({ brandKit }: BrandPanelProps) {
  const {
    editedBrand,
    setEditedBrand,
    editedAgent,
    setEditedAgent,
    editedPhone,
    setEditedPhone,
    isSaving,
    saveError,
    saveConfirmed,
    saveKit,
    rescanKit,
    approveKit,
  } = useBrandKit(brandKit);

  return (
    <>
      <PanelHeader title="Brand" detail="Approved brand kit controls the creative guardrails." />

      <FieldShell label="Agency name">
        <input
          value={editedBrand}
          onChange={(e) => setEditedBrand(e.target.value)}
        />
      </FieldShell>

      <FieldShell label="Agent name">
        <input
          value={editedAgent}
          onChange={(e) => setEditedAgent(e.target.value)}
        />
      </FieldShell>

      <FieldShell label="Phone">
        <input
          value={editedPhone}
          onChange={(e) => setEditedPhone(e.target.value)}
        />
      </FieldShell>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          className="studio-btn secondary"
          type="button"
          onClick={() => void rescanKit()}
          disabled={isSaving}
        >
          Re-scan website
        </button>
        <button
          className="studio-btn secondary"
          type="button"
          onClick={() => void saveKit()}
          disabled={isSaving}
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
        <button
          className="studio-btn secondary"
          type="button"
          onClick={() => void approveKit()}
          disabled={isSaving}
        >
          Approve kit
        </button>
      </div>

      {saveConfirmed && (
        <p style={{ margin: 0, color: "#126b35", fontWeight: 700, fontSize: 13 }}>
          Saved
        </p>
      )}
      {saveError && (
        <p style={{ margin: 0, color: "#b91c1c", fontWeight: 700, fontSize: 13 }}>
          {saveError}
        </p>
      )}

      {/* Preview card — M8: agency row + agent row + phone */}
      <div className="studio-brand-preview">
        <span style={{ background: brandKit.colours.primary || "#0f1729" }}>
          {editedBrand.charAt(0).toUpperCase()}
        </span>
        <div style={{ display: "grid", gap: 2 }}>
          <strong style={{ fontSize: 14 }}>
            {editedBrand}{" "}
            <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>
              (agency)
            </span>
          </strong>
          <span style={{ fontSize: 13 }}>
            {editedAgent}
            {" — "}
            <span style={{ color: "var(--muted)", fontSize: 12 }}>Agent</span>
          </span>
          <small>{editedPhone}</small>
        </div>
      </div>

      <div className="studio-swatches">
        {[brandKit.colours.primary, brandKit.colours.secondary, brandKit.colours.accent]
          .filter(Boolean)
          .map((colour) => (
            <span key={colour} style={{ background: colour }} />
          ))}
      </div>

      <details className="studio-advanced">
        <summary>Advanced</summary>
        <p>
          Fonts, CTA style, compliance footer, website, phone, and email stay locked to
          the approved kit.
        </p>
      </details>
    </>
  );
}
