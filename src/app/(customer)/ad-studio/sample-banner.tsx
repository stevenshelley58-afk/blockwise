"use client";

import Link from "next/link";
import { useState } from "react";

export function SampleBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "10px 16px",
        background: "#FDF8EE",
        borderBottom: "1px solid #F0E2BD",
        fontSize: "14px",
        color: "#8A5A00",
        lineHeight: 1.4,
      }}
      role="status"
    >
      <span>
        <strong>You&#39;re viewing sample data.</strong> Connect your workspace
        to see your real campaigns.
      </span>
      <Link href="/onboarding" style={{ fontWeight: 700, color: "#8A5A00", textDecoration: "underline", marginRight: 8 }}>
        Get started →
      </Link>
      <button
        type="button"
        aria-label="Dismiss sample data notice"
        onClick={() => setDismissed(true)}
        style={{
          flexShrink: 0,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontWeight: 600,
          color: "#8A5A00",
          padding: "2px 6px",
          borderRadius: "4px",
        }}
      >
        ✕
      </button>
    </div>
  );
}
