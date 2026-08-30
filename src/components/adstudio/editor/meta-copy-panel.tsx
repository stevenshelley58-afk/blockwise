"use client";

import { useEffect, useRef } from "react";
import type { MetaCopy } from "./use-editor-state";
import type { MetaEditField } from "./editor-target";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labelForMetaCta, META_CTA_VALUES, toMetaCta } from "@/lib/adstudio/meta-cta";

// ---------------------------------------------------------------------------
// Meta Copy Panel — primary text, headline, description and CTA for the
// selected template's Facebook placements.
//
// One shared set of values, matching AdDocument v1's metaPrimaryText /
// metaHeadline / metaDescription / metaCta fields: Feed and Story both read
// the same copy, so an edit here updates every placement. Save embeds these
// in the AdDocument and the save route validates them against the contract.
//
// The CTA field uses the supported Meta call-to-action values. Legacy or
// generated labels are normalised before they reach the control or document.
// ---------------------------------------------------------------------------

export interface MetaCopyPanelProps {
  className?: string;
  values: MetaCopy;
  onChange: (field: keyof MetaCopy, value: string) => void;
  onUseTemplateCopy: () => void;
  activeField?: MetaEditField | null;
  focusRequest?: { field: MetaEditField; requestId: string | number } | null;
  onFieldFocus?: (field: MetaEditField) => void;
}
/** Meta's standard CTAs (the same set the meta lead-ad pack schema allows). */
export const META_CTA_OPTIONS = [
  ...META_CTA_VALUES,
] as const;

/** Meta truncation limits used for the live preview. */
const LIMITS: Record<keyof MetaCopy, number> = {
  primaryText: 125,
  headline: 40,
  description: 90,
  cta: 24,
};

export function MetaCopyPanel({ className, values, onChange, onUseTemplateCopy, activeField = null, focusRequest = null, onFieldFocus }: MetaCopyPanelProps) {
  const focusTargetsRef = useRef(new Map<MetaEditField, HTMLElement>());
  const completedFocusRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!focusRequest) return;
    const requestKey = `${focusRequest.requestId}:${focusRequest.field}`;
    if (completedFocusRequestRef.current === requestKey) return;
    completedFocusRequestRef.current = requestKey;
    const frame = window.requestAnimationFrame(() => {
      const target = focusTargetsRef.current.get(focusRequest.field);
      if (!target) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest]);

  const setFocusTarget = (field: MetaEditField, node: HTMLElement | null) => {
    if (node) focusTargetsRef.current.set(field, node);
    else focusTargetsRef.current.delete(field);
  };

  return (
    <aside aria-label="Meta copy" className={cn("w-full shrink-0 overflow-y-auto bg-card p-4 xl:w-auto", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Meta copy</h3>
        <Button type="button" variant="outline" size="sm" onClick={onUseTemplateCopy} className="min-h-9 rounded-full px-3 text-xs">
          Use template copy
        </Button>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
        Primary text, headline and description appear in Facebook Feed. The
        CTA also appears in Story — edit once and both previews update.
      </p>

      <div className="space-y-4">
        <TextField
          label="Primary text"
          field="primaryText"
          value={values.primaryText}
          onChange={onChange}
          maxLength={LIMITS.primaryText}
          textarea
          active={activeField === "primaryText"}
          setFocusTarget={node => setFocusTarget("primaryText", node)}
          onFocus={() => onFieldFocus?.("primaryText")}
        />
        <TextField
          label="Headline"
          field="headline"
          value={values.headline}
          onChange={onChange}
          maxLength={LIMITS.headline}
          active={activeField === "headline"}
          setFocusTarget={node => setFocusTarget("headline", node)}
          onFocus={() => onFieldFocus?.("headline")}
        />
        <TextField
          label="Description"
          field="description"
          value={values.description}
          onChange={onChange}
          maxLength={LIMITS.description}
          active={activeField === "description"}
          setFocusTarget={node => setFocusTarget("description", node)}
          onFocus={() => onFieldFocus?.("description")}
        />

        <div className={cn("-mx-2 rounded-(--r-card) p-2 transition-colors", activeField === "cta" && "bg-primary/5 ring-2 ring-primary/35")}>
          <Label htmlFor="meta-copy-cta" className="mb-1 block text-sm font-medium">
            Call to action
          </Label>
          <select
            ref={node => setFocusTarget("cta", node)}
            value={toMetaCta(values.cta)}
            onChange={e => onChange("cta", e.target.value)}
            onFocus={() => onFieldFocus?.("cta")}
            id="meta-copy-cta"
            className="min-h-11 w-full rounded-(--r-card) border border-input bg-muted/30 px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {META_CTA_OPTIONS.map(cta => (
              <option key={cta} value={cta}>
                {labelForMetaCta(cta)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="mt-5 rounded-(--r-card) border border-border bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        The Facebook Feed and Story previews update live as you type.
      </p>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// TextField — labelled input with a live character counter.
// ---------------------------------------------------------------------------

function TextField({
  label,
  field,
  value,
  onChange,
  maxLength,
  textarea = false,
  active = false,
  setFocusTarget,
  onFocus,
}: {
  label: string;
  field: keyof MetaCopy;
  value: string;
  onChange: (field: keyof MetaCopy, value: string) => void;
  maxLength: number;
  textarea?: boolean;
  active?: boolean;
  setFocusTarget: (node: HTMLElement | null) => void;
  onFocus: () => void;
}) {
  const shared = "min-h-11 w-full rounded-(--r-card) border border-input bg-muted/30 px-3 text-base shadow-xs outline-none selection:bg-primary selection:text-primary-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
  const inputId = `meta-copy-${field}`;
  return (
    <div className={cn("-mx-2 rounded-(--r-card) p-2 transition-colors", active && "bg-primary/5 ring-2 ring-primary/35")}>
      <Label htmlFor={inputId} className="mb-1 block text-sm font-medium">{label}</Label>
      {textarea ? (
        <textarea
          ref={setFocusTarget}
          id={inputId}
          aria-label={label}
          value={value}
          maxLength={maxLength}
          rows={3}
          onChange={e => onChange(field, e.target.value)}
          onFocus={onFocus}
          className={`${shared} min-h-24 py-2 resize-y`}
        />
      ) : (
        <Input
          ref={setFocusTarget}
          id={inputId}
          aria-label={label}
          type="text"
          value={value}
          maxLength={maxLength}
          onChange={e => onChange(field, e.target.value)}
          onFocus={onFocus}
          className={shared}
        />
      )}
      <span className="mt-1 block text-right text-[11px] tabular-nums text-muted-foreground">
        {value.length}/{maxLength}
      </span>
    </div>
  );
}
