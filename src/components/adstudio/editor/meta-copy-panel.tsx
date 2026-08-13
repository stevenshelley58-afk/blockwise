"use client";

import { useMemo } from "react";
import type { MetaCopy } from "./use-editor-state.js";

// ---------------------------------------------------------------------------
// Meta Copy Panel — primary text, headline, description and CTA for the
// Meta placements of a pack.
//
// One shared set of values, matching AdDocument v1's metaPrimaryText /
// metaHeadline / metaDescription / metaCta fields: Feed and Story both read
// the same copy, so an edit here updates every placement. Save embeds these
// in the AdDocument and the save route validates them against the contract.
//
// The CTA field is a select of Meta's standard call-to-action values with a
// "Custom…" escape hatch — AdDocument stores whatever string the user picks
// or types.
// ---------------------------------------------------------------------------

export interface MetaCopyPanelProps {
  values: MetaCopy;
  onChange: (field: keyof MetaCopy, value: string) => void;
}

/** Meta's standard CTAs (the same set the meta lead-ad pack schema allows). */
export const META_CTA_OPTIONS = [
  "LEARN_MORE",
  "SIGN_UP",
  "DOWNLOAD",
  "CONTACT_US",
] as const;

/** Meta truncation limits used for the live preview. */
const LIMITS: Record<keyof MetaCopy, number> = {
  primaryText: 125,
  headline: 40,
  description: 30,
  cta: 25,
};

export function MetaCopyPanel({ values, onChange }: MetaCopyPanelProps) {
  const customCta = !(META_CTA_OPTIONS as readonly string[]).includes(values.cta);

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-(--line) bg-(--surface) p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
          <span className="mb-1 block text-sm font-medium text-foreground">
            Call to action
          </span>
          <select
            value={customCta ? "CUSTOM" : values.cta}
            onChange={e => {
              const next = e.target.value;
              onChange("cta", next === "CUSTOM" ? "" : next);
            }}
            className="w-full rounded-(--r-control) border border-(--line) bg-(--surface-subtle) px-3 py-2 text-sm text-foreground outline-none transition focus:border-(--ui-primary) focus:ring-1 focus:ring-(--ui-primary)/40"
            aria-label="Call to action"
          >
            {META_CTA_OPTIONS.map(cta => (
              <option key={cta} value={cta}>
                {cta.replaceAll("_", " ")}
              </option>
            ))}
            <option value="CUSTOM">Custom…</option>
          </select>
          {customCta && (
            <div className="mt-2">
              <TextField
                label="Custom CTA"
                field="cta"
                value={values.cta}
                onChange={onChange}
                maxLength={LIMITS.cta}
              />
            </div>
          )}
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
  const shared =
    "w-full rounded-(--r-control) border border-(--line) bg-(--surface-subtle) px-3 py-2 text-sm text-foreground outline-none transition focus:border-(--ui-primary) focus:ring-1 focus:ring-(--ui-primary)/40";
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-foreground">{label}</span>
      {textarea ? (
        <textarea
          value={value}
          maxLength={maxLength}
          rows={3}
          onChange={e => onChange(field, e.target.value)}
          className={`${shared} resize-y`}
        />
      ) : (
        <input
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
    </label>
  );
}

// ---------------------------------------------------------------------------
// TruncationPreview — compact feed-style preview of how the copy truncates.
// Plain text only; deliberately NOT a Facebook/IG wireframe.
// ---------------------------------------------------------------------------

function TruncationPreview({ values }: { values: MetaCopy }) {
  const primary = useMemo(
    () => truncate(values.primaryText, LIMITS.primaryText),
    [values.primaryText],
  );
  const headline = truncate(values.headline, LIMITS.headline);
  const description = truncate(values.description, LIMITS.description);
  const cta = truncate(values.cta, LIMITS.cta) || "Learn more";

  return (
    <section aria-label="Truncation preview" className="mt-5">
      <h4 className="mb-2 text-xs font-semibold text-foreground">
        Feed preview
      </h4>
      <div className="rounded-(--r-card) border border-(--line) bg-white p-3 text-[13px] leading-snug text-neutral-800">
        <p className="line-clamp-4">{primary || "Primary text"}</p>
        <p className="mt-2 truncate font-semibold text-neutral-900">
          {headline || "Headline"}
        </p>
        <p className="mt-1 truncate text-neutral-500">
          {description || "Description"}
        </p>
        <p className="mt-2 inline-block rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600">
          {cta}
        </p>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Copy is truncated in feed at 125 / 40 / 30 characters (primary text,
        headline, description). Longest text is cut first.
      </p>
    </section>
  );
}

function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max).replace(/\s+\S*$/u, "");
  return `${cut}…`;
}
