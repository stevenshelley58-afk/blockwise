"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RefreshCw, Sparkles, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { labelForMetaCta } from "@/lib/adstudio/meta-cta";
import { cn } from "@/lib/utils";

import type { MetaCopy } from "./use-editor-state";
import {
  aiCopyProposalSelectionKeys,
  metaCopySelectionKey,
  onImageCopySelectionKey,
  selectedAiCopyPayload,
  type AiCopyProposal,
  type AiCopySelectionKey,
  type SelectedAiCopyPayload,
} from "./ai-copy-selection";

export type AiCopyAssistantTextInput = {
  key: string;
  label: string;
  maxLength?: number;
};

export interface AiCopyAssistantProps {
  className?: string;
  brief: string;
  proposal: AiCopyProposal | null;
  busy: boolean;
  error?: string | null;
  textInputs: readonly AiCopyAssistantTextInput[];
  brandPackName?: string | null;
  onBriefChange: (value: string) => void;
  onGenerate: () => void | Promise<void>;
  onApply: (payload: SelectedAiCopyPayload) => void;
  onDismiss: () => void;
}

const META_LABELS: Record<keyof MetaCopy, string> = {
  primaryText: "Primary text",
  headline: "Headline",
  description: "Description",
  cta: "Call to action",
};

/**
 * Brief-first AI copy workflow. Generation is deliberately read-only: the
 * editor changes only after the customer chooses Use selected or Use all.
 */
export function AiCopyAssistant({
  className,
  brief,
  proposal,
  busy,
  error,
  textInputs,
  brandPackName,
  onBriefChange,
  onGenerate,
  onApply,
  onDismiss,
}: AiCopyAssistantProps) {
  const declaredKeySignature = textInputs.map(input => input.key).join("\u0000");
  const availableKeys = useMemo(
    () => proposal ? aiCopyProposalSelectionKeys(proposal, declaredKeySignature ? declaredKeySignature.split("\u0000") : []) : [],
    [declaredKeySignature, proposal],
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<AiCopySelectionKey>>(() => new Set());

  useEffect(() => {
    setSelectedKeys(new Set(availableKeys));
  }, [availableKeys]);

  const selectedCount = availableKeys.filter(key => selectedKeys.has(key)).length;
  const inputLabels = useMemo(
    () => new Map(textInputs.map(input => [input.key, input.label])),
    [textInputs],
  );

  const toggleSelection = (key: AiCopySelectionKey, checked: boolean) => {
    setSelectedKeys(previous => {
      const next = new Set(previous);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const applySelected = () => {
    if (!proposal || selectedCount === 0) return;
    onApply(selectedAiCopyPayload(proposal, selectedKeys));
  };

  const applyAll = () => {
    if (!proposal) return;
    onApply(selectedAiCopyPayload(proposal, availableKeys));
  };

  return (
    <section aria-label="AI copy" className={cn("border-b border-border bg-card p-4", className)}>
      <form
        aria-label="Generate AI copy suggestions"
        onSubmit={event => {
          event.preventDefault();
          if (!busy && brief.trim()) void onGenerate();
        }}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles aria-hidden className="size-4" />
              Write with AI
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Describe the ad once. Review every suggestion before anything changes.
            </p>
          </div>
          <span className="max-w-[48%] shrink-0 truncate rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground" title={brandPackName ?? "No Brand Pack selected"}>
            Brand Pack · {brandPackName?.trim() || "Not set"}
          </span>
        </div>

        <Label htmlFor="ai-copy-brief" className="mt-4 mb-1.5 block text-sm font-medium">
          Ad brief
        </Label>
        <textarea
          id="ai-copy-brief"
          value={brief}
          onChange={event => onBriefChange(event.target.value)}
          rows={5}
          maxLength={2000}
          aria-describedby="ai-copy-brief-help ai-copy-brief-count"
          placeholder="Example: Promote Saturday’s open home at 18 Smith Street. Mention the renovated kitchen and offer the suburb guide."
          className="min-h-32 w-full resize-y rounded-(--r-card) border border-input bg-muted/30 px-3 py-2 text-base leading-relaxed shadow-xs outline-none selection:bg-primary selection:text-primary-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <div className="mt-1 flex items-start justify-between gap-3 text-[11px] leading-relaxed text-muted-foreground">
          <span id="ai-copy-brief-help">Uses the selected template and Brand Pack voice.</span>
          <span id="ai-copy-brief-count" className="shrink-0 tabular-nums">{brief.length}/2000</span>
        </div>
        <Button type="submit" disabled={busy || !brief.trim()} className="mt-3 min-h-11 w-full rounded-full" aria-busy={busy}>
          {proposal ? <RefreshCw aria-hidden className="size-4" /> : <Sparkles aria-hidden className="size-4" />}
          {busy ? "Writing suggestions…" : proposal ? "Regenerate suggestions" : "Generate suggestions"}
        </Button>
      </form>

      {error ? (
        <Alert variant="destructive" className="mt-4" aria-live="polite">
          <AlertTitle>Copy suggestions were not updated</AlertTitle>
          <AlertDescription>
            <p>{error}</p>
            {proposal ? <p>Your last complete suggestion is still available below.</p> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {proposal ? (
        <div className="mt-5 border-t border-border pt-4" aria-label="AI copy suggestions">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Review suggestions</h4>
              <p className="mt-0.5 text-xs text-muted-foreground" role="status" aria-live="polite">
                {selectedCount} of {availableKeys.length} fields selected
              </p>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={onDismiss} aria-label="Dismiss AI copy suggestions" className="min-h-11 min-w-11 rounded-full">
              <X aria-hidden className="size-4" />
            </Button>
          </div>

          <SuggestionGroup title="Design text">
            {Object.entries(proposal.onImage).map(([inputKey, value], index) => (
              <SuggestionRow
                key={onImageCopySelectionKey(inputKey)}
                id={`ai-copy-on-image-${index}`}
                label={inputLabels.get(inputKey) ?? inputKey}
                value={value}
                checked={selectedKeys.has(onImageCopySelectionKey(inputKey))}
                onCheckedChange={checked => toggleSelection(onImageCopySelectionKey(inputKey), checked)}
              />
            ))}
          </SuggestionGroup>

          <SuggestionGroup title="Facebook ad copy" className="mt-5">
            {(Object.keys(META_LABELS) as (keyof MetaCopy)[]).map((field, index) => (
              <SuggestionRow
                key={metaCopySelectionKey(field)}
                id={`ai-copy-meta-${index}`}
                label={META_LABELS[field]}
                value={field === "cta" ? labelForMetaCta(proposal.copy[field]) : proposal.copy[field]}
                checked={selectedKeys.has(metaCopySelectionKey(field))}
                onCheckedChange={checked => toggleSelection(metaCopySelectionKey(field), checked)}
              />
            ))}
          </SuggestionGroup>

          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" onClick={applyAll} disabled={busy} className="min-h-11 rounded-full">
              Use all
            </Button>
            <Button type="button" onClick={applySelected} disabled={busy || selectedCount === 0} className="min-h-11 rounded-full">
              Use selected ({selectedCount})
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SuggestionGroup({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className={className}>
      <legend className="mb-2 text-xs font-semibold text-foreground">{title}</legend>
      <div className="divide-y divide-border overflow-hidden rounded-(--r-card) border border-border bg-muted/20">
        {children}
      </div>
    </fieldset>
  );
}

function SuggestionRow({
  id,
  label,
  value,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  value: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex min-h-14 cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/45 focus-within:bg-muted/45">
      <span className="grid min-h-11 min-w-6 shrink-0 place-items-center">
        <Checkbox id={id} checked={checked} onCheckedChange={value => onCheckedChange(value === true)} aria-label={`Use ${label}`} />
      </span>
      <span className="min-w-0 flex-1 py-1">
        <span className="block text-[11px] font-semibold text-muted-foreground">{label}</span>
        <span className="mt-0.5 block whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{value}</span>
      </span>
    </label>
  );
}
