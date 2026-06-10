"use client";

import Link from "next/link";

/**
 * Non-dismissable notice rendered at the top of Ad Studio for sample
 * workspaces. A control that can be hidden while the user is still in a
 * sample workspace erodes trust: every other surface they touch after
 * dismissing it shows "fake" data with no reminder. The banner stays
 * visible for the lifetime of the sample workspace and disappears only
 * when the user finishes onboarding (`/onboarding`).
 */
export function SampleBanner() {
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
      aria-live="polite"
    >
      <span>
        <strong>You&#39;re viewing a sample workspace.</strong> This is demo ad data, not real
        campaign activity from your account.
      </span>
      <Link
        href="/onboarding"
        style={{
          fontWeight: 700,
          color: "#8A5A00",
          textDecoration: "underline",
          flexShrink: 0,
        }}
      >
        Set up your workspace
      </Link>
    </div>
  );
}
