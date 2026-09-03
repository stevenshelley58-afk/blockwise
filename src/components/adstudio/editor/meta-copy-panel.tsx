"use client";

import type { MetaCopy } from "./use-editor-state";
import { META_COPY_CTA_VALUES, META_COPY_CONSTRAINTS } from "../../../lib/adstudio/meta-copy-contract";
import { ctaLabelText, truncateForPreview } from "./preview-text";
import { isMetaCta, toMetaCta } from "../../../lib/adstudio/meta-cta";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// Meta Copy Panel — primary text, headline, description and CTA for the
// Meta placements of a pack.
//
// One shared set of values, matching AdDocument v1's metaPrimaryText /
// metaHeadline / metaDescription / metaCta fields: Feed and Story both read
// the same copy, so an edit here updates every placement. Save embeds these
// in the AdDocument and the save route validates them against the contract.
//
// The CTA field only exposes values Meta can publish. Legacy labels are mapped
// to a supported value for display rather than forwarded as custom buttons.
// ---------------------------------------------------------------------------

export interface MetaCopyPanelProps {
  className?: string;
  values: MetaCopy;
  onChange: (field: keyof MetaCopy, value: string) => void;
}

/** Meta's standard CTAs (the same set the meta lead-ad pack schema allows). */
export const META_CTA_OPTIONS = META_COPY_CTA_VALUES;

/** Meta truncation limits used for the live preview. */
const LIMITS = META_COPY_CONSTRAINTS;

export function MetaCopyPanel({ className, values, onChange }: MetaCopyPanelProps) {
  const selectedCta = isMetaCta(values.cta) ? values.cta : toMetaCta(values.cta || "LEARN_MORE");

  return (
    <aside aria-label="Meta copy" className={cn("w-full shrink-0 overflow-y-auto bg-card p-4 xl:w-auto", className)}>
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        Meta copy
      </h3>
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
        Primary text, headline, description and CTA show with the design in
        every placement — edit once, all placements update.
      </p>

      <div className="space-y-4">
        <TextField
          label="Primary text"
          field="primaryText"
          value={values.primaryText}
          onChange={onChange}
          maxLength={LIMITS.primaryText}
          textarea
        />
        <TextField
          label="Headline"
          field="headline"
          value={values.headline}
          onChange={onChange}
          maxLength={LIMITS.headline}
        />
        <TextField
          label="Description"
          field="description"
          value={values.description}
          onChange={onChange}
          maxLength={LIMITS.description}
        />

        <div>
          <Label htmlFor="meta-copy-cta" className="mb-1 block text-sm font-medium">
            Call to action
          </Label>
          <select
            value={selectedCta}
            onChange={e => onChange("cta", e.target.value)}
            id="meta-copy-cta"
            className="min-h-11 w-full rounded-(--r-card) border border-input bg-muted/30 px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {META_CTA_OPTIONS.map(cta => (
              <option key={cta} value={cta}>
                {ctaLabelText(cta)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <TruncationPreview values={values} />
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
}: {
  label: string;
  field: keyof MetaCopy;
  value: string;
  onChange: (field: keyof MetaCopy, value: string) => void;
  maxLength: number;
  textarea?: boolean;
}) {
  const shared = "min-h-11 w-full rounded-(--r-card) border border-input bg-muted/30 px-3 text-base shadow-xs outline-none selection:bg-primary selection:text-primary-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
  const inputId = `meta-copy-${field}`;
  return (
    <div className="block">
      <Label htmlFor={inputId} className="mb-1 block text-sm font-medium">{label}</Label>
      {textarea ? (
        <textarea
          id={inputId}
          aria-label={label}
          value={value}
          maxLength={maxLength}
          rows={3}
          onChange={e => onChange(field, e.target.value)}
          className={`${shared} min-h-24 py-2 resize-y`}
        />
      ) : (
        <Input
          id={inputId}
          aria-label={label}
          type="text"
          value={value}
          maxLength={maxLength}
          onChange={e => onChange(field, e.target.value)}
          className={shared}
        />
      )}
      <span className="mt-1 block text-right text-[11px] tabular-nums text-muted-foreground">
        {value.length}/{maxLength}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TruncationPreview — compact feed-style preview of how the copy truncates.
// Plain text only; deliberately NOT a Facebook/IG wireframe.
// ---------------------------------------------------------------------------

function TruncationPreview({ values }: { values: MetaCopy }) {
  const primary = truncateForPreview(values.primaryText, LIMITS.primaryText);
  const headline = truncateForPreview(values.headline, LIMITS.headline);
  const description = truncateForPreview(values.description, LIMITS.description);
  const cta = truncateForPreview(ctaLabelText(values.cta), LIMITS.cta) || "Learn more";

  return (
    <section aria-label="Truncation preview" className="mt-5">
      <h4 className="mb-2 text-xs font-semibold text-foreground">
        Feed preview
      </h4>
      <div className="rounded-(--r-card) border border-border bg-background p-3 text-[13px] leading-snug text-foreground">
        <p className="line-clamp-4">{primary || "Primary text"}</p>
        <p className="mt-2 truncate font-semibold text-foreground">
          {headline || "Headline"}
        </p>
        <p className="mt-1 truncate text-muted-foreground">
          {description || "Description"}
        </p>
        <p className="mt-2 inline-block rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          {cta}
        </p>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Feed and Story use the same limits: {LIMITS.primaryText} / {LIMITS.headline} / {LIMITS.description} / {LIMITS.cta} characters (primary text, headline, description, CTA).
      </p>
    </section>
  );
}
