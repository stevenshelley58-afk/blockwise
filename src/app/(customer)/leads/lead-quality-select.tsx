"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";

import type { LeadQualityLabel } from "@/lib/operator/overview";
import { cn } from "@/lib/utils";

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
    <span className="relative inline-flex">
      <select
        aria-label="Lead quality"
        className={cn(
          "lead-quality-select appearance-none rounded-full py-[5px] pr-[24px] pl-[11px] text-[11.5px] font-bold transition-[border-color,box-shadow,background-color] duration-150",
          selected === "high_intent"
            ? "border border-transparent bg-success-soft text-success"
            : "border border-(--line) bg-(--surface-subtle) text-foreground hover:border-(--line-heavy)",
          disabled ? "cursor-default opacity-60" : "cursor-pointer",
        )}
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
      <ChevronDown
        aria-hidden
        size={9}
        strokeWidth={2.5}
        className="pointer-events-none absolute top-1/2 right-[9px] -translate-y-1/2 text-(--faint)"
      />
    </span>
  );
}
