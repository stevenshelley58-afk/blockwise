"use client";

import { useState, useTransition } from "react";

import type { LeadQualityLabel } from "@/lib/operator/overview";

const LABELS: Array<{ value: LeadQualityLabel; label: string }> = [
  { value: "valid", label: "Valid" },
  { value: "invalid", label: "Invalid" },
  { value: "high_intent", label: "High intent" },
];

export function LeadQualitySelect({
  leadId,
  workspaceId,
  value,
  disabled = false,
}: {
  leadId: string;
  workspaceId: string;
  value: LeadQualityLabel | "unlabelled";
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState(value);
  const [lastSaved, setLastSaved] = useState(value);
  const [isPending, startTransition] = useTransition();

  return (
    <select
      aria-label="Lead quality"
      className="lead-quality-select"
      disabled={disabled || isPending}
      value={selected === "unlabelled" ? "" : selected}
      onChange={(event) => {
        const next = event.target.value as LeadQualityLabel;
        setSelected(next);
        startTransition(async () => {
          const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}/quality`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId, label: next }),
          });

          if (response.ok) {
            setLastSaved(next);
          } else {
            setSelected(lastSaved);
          }
        });
      }}
    >
      <option value="" disabled>
        Label
      </option>
      {LABELS.map((label) => (
        <option key={label.value} value={label.value}>
          {label.label}
        </option>
      ))}
    </select>
  );
}
