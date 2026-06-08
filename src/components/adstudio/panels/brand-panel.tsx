"use client";

import Link from "next/link";
import { Globe2 } from "lucide-react";

import type { AdStudioBrandKit } from "@/lib/adstudio";

import { PanelHeader } from "../inspector";

type BrandPanelProps = {
  brandKit: AdStudioBrandKit;
  /** @deprecated Derived internally — kept for caller compatibility */
  brand?: string;
};

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

export function BrandPanel({ brandKit }: BrandPanelProps) {
  const name = brandKit.identity.businessName || "Your brand";
  const domain = hostOf(brandKit.source.url);
  const approved = brandKit.reviewStatus === "approved";
  const voiceLine = (brandKit.tone.voice || "").split(".")[0] || "Not set yet";
  const swatches = [
    brandKit.colours.primary,
    brandKit.colours.secondary,
    brandKit.colours.accent,
    brandKit.colours.background,
    brandKit.colours.text,
  ].filter(Boolean);

  return (
    <>
      <PanelHeader title="Brand" detail="Your approved kit sets the guardrails for every ad." />

      <div className="studio-card" style={{ gap: 13 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              width: 46,
              height: 46,
              borderRadius: 11,
              background: brandKit.colours.primary || "#131b2e",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontWeight: 800,
              fontSize: 19,
            }}
          >
            {name.charAt(0).toUpperCase()}
          </span>
          <span style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15, fontWeight: 650, display: "block" }}>{name}</strong>
            <small style={{ color: "var(--muted)", fontSize: 12 }}>{domain}</small>
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11.5,
              fontWeight: 650,
              borderRadius: 999,
              padding: "5px 11px",
              background: approved ? "#ecfdf5" : "#fdf8ee",
              color: approved ? "#006d38" : "#8a5a00",
              whiteSpace: "nowrap",
            }}
          >
            {approved ? "✓ Approved" : "Pending review"}
          </span>
        </div>

        <div style={{ display: "flex", gap: 7 }}>
          {swatches.map((colour) => (
            <i
              key={colour}
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: colour,
                border: "1px solid rgba(15,23,41,.08)",
              }}
            />
          ))}
        </div>

        <div style={{ display: "grid", gap: 8, fontSize: 12.5, color: "var(--muted)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span>Voice</span>
            <b style={{ color: "var(--ink)", fontWeight: 600, textAlign: "right" }}>{voiceLine}</b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span>Fonts</span>
            <b style={{ color: "var(--ink)", fontWeight: 600, textAlign: "right" }}>
              {brandKit.typography.headingFont} / {brandKit.typography.bodyFont}
            </b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span>Contact</span>
            <b style={{ color: "var(--ink)", fontWeight: 600, textAlign: "right" }}>
              {brandKit.contact.phone ?? "—"}
            </b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span>Compliance</span>
            <b style={{ color: "var(--ink)", fontWeight: 600, textAlign: "right" }}>
              {brandKit.compliance.disclaimers.length} disclaimer
              {brandKit.compliance.disclaimers.length === 1 ? "" : "s"}
            </b>
          </div>
        </div>

        <Link href="/ad-studio/brand" className="studio-btn publish block" style={{ textDecoration: "none" }}>
          Open Brand Studio
        </Link>
      </div>

      <div className="studio-upload-card" style={{ cursor: "default" }}>
        <span className="studio-upload-ic">
          <Globe2 aria-hidden size={17} />
        </span>
        <span>
          <strong>{domain}</strong>
          <small>Scan and edit the full kit in Brand Studio</small>
        </span>
      </div>
    </>
  );
}
