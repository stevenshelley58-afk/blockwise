"use client";

import type { AdStudioBrandKit } from "@/lib/adstudio";

import { FieldShell, PanelHeader } from "../inspector";

type BrandPanelProps = {
  brand: string;
  brandKit: AdStudioBrandKit;
};

export function BrandPanel({ brand, brandKit }: BrandPanelProps) {
  return (
    <>
      <PanelHeader title="Brand" detail="Approved brand kit controls the creative guardrails." />
      <FieldShell label="Agency name">
        <input value={brand} readOnly />
      </FieldShell>
      <FieldShell label="Agent name">
        <input value={brandKit.identity.tradingName ?? "Northstar Agent"} readOnly />
      </FieldShell>
      <div className="studio-brand-preview">
        <span style={{ background: brandKit.colours.primary || "#0f1729" }}>{brand.charAt(0)}</span>
        <div>
          <strong>{brand}</strong>
          <small>{brandKit.contact.phone ?? "(08) 9999 0000"}</small>
        </div>
      </div>
      <div className="studio-swatches">
        {[brandKit.colours.primary, brandKit.colours.secondary, brandKit.colours.accent].filter(Boolean).map((colour) => (
          <span key={colour} style={{ background: colour }} />
        ))}
      </div>
      <details className="studio-advanced">
        <summary>Advanced</summary>
        <p>Fonts, CTA style, compliance footer, website, phone, and email stay locked to the approved kit.</p>
      </details>
    </>
  );
}
