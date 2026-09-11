"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * The Blockwise Business ID with a copy control. Meta's Partner business ID
 * field is the only place a customer types this, so it sits next to the step
 * that uses it.
 */
export function CopyBusinessId({ businessId }: { businessId: string | null }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!businessId) return;
    try {
      await navigator.clipboard.writeText(businessId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be blocked; the ID stays selectable in the field.
    }
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-(--r-card) border border-(--line-heavy) bg-(--surface-subtle) p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <span className="block text-[11.5px] font-semibold text-muted-foreground">
          Blockwise Business ID
        </span>
        <code className="mt-0.5 block break-all text-[15.5px] font-bold tracking-[0.04em]">
          {businessId ?? "Ask support for your Business ID"}
        </code>
      </div>
      <Button
        variant="outline"
        className="min-h-11"
        disabled={!businessId}
        onClick={() => void copy()}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy ID"}
      </Button>
    </div>
  );
}
