"use client";

import { COLOUR_ROLES, type ColourRole } from "../../../../packages/ad-template-contract/src/types";
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Colour panel — three mutually exclusive modes:
//   1. Template colours  — the template's own palette.
//   2. Brand Pack colours — the workspace Brand Pack palette (disabled when
//      the workspace has no Brand Pack yet).
//   3. Custom colours    — a per-role colour picker + hex input for every
//      supported role (background, primary, secondary, accent, main text,
//      inverse text).
// The swatch strip previews the live resolved palette (the preview updates
// from the same map, so both move together).
// ---------------------------------------------------------------------------

export type ColourMode = "template" | "brand_pack" | "custom";

const MODE_OPTIONS: Array<{ value: ColourMode; label: string }> = [
  { value: "template", label: "Template" },
  { value: "brand_pack", label: "Brand Pack" },
  { value: "custom", label: "Custom colours" },
];

const ROLE_LABELS: Record<ColourRole, string> = {
  background: "Background",
  primary: "Primary",
  secondary: "Secondary",
  accent: "Accent",
  mainText: "Main text",
  inverseText: "Inverse text",
};

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export interface ColourToggleProps {
  mode: ColourMode;
  /** Whether the workspace has a Brand Pack (workspace option disabled without one). */
  brandPackAvailable: boolean;
  /** Live resolved palette to preview as swatches. */
  resolvedColourMap: Record<ColourRole, string>;
  onModeChange: (mode: ColourMode) => void;
  /** Per-role custom colour updates (only called in custom mode). */
  onCustomColourChange?: (role: ColourRole, hex: string) => void;
}

/** Three explicit palette sources with validated, role-based manual editing. */
export function ColourToggle({
  mode,
  brandPackAvailable,
  resolvedColourMap,
  onModeChange,
  onCustomColourChange,
}: ColourToggleProps) {
  const panelId = useId();

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Colour mode"
        className="grid grid-cols-3 gap-1 rounded-(--r-card) border border-border bg-muted/40 p-1"
      >
        {MODE_OPTIONS.map(({ value, label }) => {
          const disabled = value === "brand_pack" && !brandPackAvailable;
          const selected = mode === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onModeChange(value)}
              className={cn(
                "min-h-11 rounded-(--r-ctl) px-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] leading-relaxed text-muted-foreground">
          {mode === "custom"
            ? "Fine-tune each colour role individually."
            : brandPackAvailable
              ? "Use Brand Pack colours instead of the template palette."
            : "Add Template colours or a Brand Pack in Brand Studio to use them here."}
        </span>
        <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
          {COLOUR_ROLES.map((role) => (
            <span
              key={role}
              className="h-3 w-3 rounded-full border border-foreground/10"
              style={{ backgroundColor: resolvedColourMap[role] ?? "var(--muted)" }}
              title={role}
            />
          ))}
        </span>
      </div>

      {mode === "custom" ? (
        <div className="space-y-3 rounded-(--r-card) border border-border p-3" aria-label="Custom colours">
          {COLOUR_ROLES.map((role) => (
            <CustomColourRow
              key={role}
              role={role}
              label={ROLE_LABELS[role]}
              value={resolvedColourMap[role] ?? "#000000"}
              onChange={hex => onCustomColourChange?.(role, hex)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CustomColourRow({
  role,
  label,
  value,
  onChange,
}: {
  role: ColourRole;
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const rowId = useId();
  const hexId = `${rowId}-hex`;
  const valid = HEX_COLOUR.test(value.trim());
  return (
    <div className="flex items-center gap-3" data-role={role}>
      <input
        type="color"
        value={valid ? value : "#000000"}
        onChange={e => onChange(e.target.value)}
        aria-label={`${label} colour`}
        className="h-9 w-9 shrink-0 cursor-pointer rounded-(--r-ctl) border border-border bg-transparent p-0.5"
      />
      <Label htmlFor={hexId} className="min-w-0 flex-1 truncate text-sm font-medium">
        {label}
      </Label>
      <Input
        id={hexId}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={e => {
          // Normalise shorthand on blur; invalid text falls back to the
          // current palette value for that role.
          if (!HEX_COLOUR.test(e.target.value.trim())) onChange(value);
        }}
        maxLength={9}
        spellCheck={false}
        aria-invalid={!valid}
        className="min-h-9 w-24 rounded-(--r-ctl) bg-muted/30 px-2 text-right font-mono text-xs"
      />
    </div>
  );
}

function PaletteStrip({ colours }: { colours: Record<ColourRole, string> }) {
  return (
    <div className="flex h-8 overflow-hidden rounded-full border border-border bg-muted" aria-label="Current colour palette">
      {COLOUR_ROLES.map(role => (
        <span
          key={role}
          className="min-w-0 flex-1"
          style={{ backgroundColor: colours[role] ?? "var(--muted)" }}
          title={`${ROLE_LABELS[role].label}: ${colours[role]}`}
        >
          <span className="sr-only">{ROLE_LABELS[role].label}: {colours[role]}</span>
        </span>
      ))}
    </div>
  );
}

export function normaliseSixDigitHex(value: string): string | null {
  const trimmed = value.trim();
  if (SIX_DIGIT_HEX.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed.slice(1).split("").map(character => character.repeat(2)).join("")}`.toUpperCase();
  }
  return null;
}

export function contrastRatio(foreground: string, background: string): number | null {
  const foregroundRgb = hexToRgb(foreground);
  const backgroundRgb = hexToRgb(background);
  if (!foregroundRgb || !backgroundRgb) return null;
  const lighter = Math.max(relativeLuminance(foregroundRgb), relativeLuminance(backgroundRgb));
  const darker = Math.min(relativeLuminance(foregroundRgb), relativeLuminance(backgroundRgb));
  return (lighter + 0.05) / (darker + 0.05);
}

export function colourContrastWarnings(colours: Record<ColourRole, string>): string[] {
  const pairs: Array<{ foreground: ColourRole; background: ColourRole; label: string }> = [
    { foreground: "mainText", background: "background", label: "Text on the background" },
    { foreground: "mainText", background: "secondary", label: "Text on secondary surfaces" },
    { foreground: "inverseText", background: "primary", label: "Inverse text on primary surfaces" },
    { foreground: "inverseText", background: "accent", label: "Inverse text on accent elements" },
  ];
  return pairs.flatMap(({ foreground, background, label }) => {
    const ratio = contrastRatio(colours[foreground], colours[background]);
    return ratio !== null && ratio < 4.5 ? [`${label} is ${ratio.toFixed(1)}:1; aim for at least 4.5:1.`] : [];
  });
}

type Rgb = { red: number; green: number; blue: number };

function hexToRgb(value: string): Rgb | null {
  const normalised = normaliseSixDigitHex(value);
  if (!normalised) return null;
  return {
    red: Number.parseInt(normalised.slice(1, 3), 16),
    green: Number.parseInt(normalised.slice(3, 5), 16),
    blue: Number.parseInt(normalised.slice(5, 7), 16),
  };
}

function relativeLuminance(rgb: Rgb): number {
  const linear = [rgb.red, rgb.green, rgb.blue].map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
