"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, Check, RotateCcw } from "lucide-react";
import {
  COLOUR_ROLES,
  type ColourMode,
  type ColourRole,
} from "../../../../packages/ad-template-contract/src/types";

const ROLE_LABELS: Record<ColourRole, { label: string; description: string }> = {
  background: { label: "Background", description: "Canvas and open space" },
  primary: { label: "Primary surface", description: "Main panels and cards" },
  secondary: { label: "Secondary surface", description: "Supporting panels and details" },
  accent: { label: "Accent", description: "Buttons, badges and highlights" },
  mainText: { label: "Text on light", description: "Headings and body copy" },
  inverseText: { label: "Text on colour", description: "Copy on dark or accent surfaces" },
};

const MODES: Array<{ value: ColourMode; label: string; description: string }> = [
  { value: "template", label: "Template", description: "Designed palette" },
  { value: "brand_pack", label: "Brand Pack", description: "Workspace palette" },
  { value: "manual", label: "Custom", description: "Choose every role" },
];

const SIX_DIGIT_HEX = /^#[0-9a-fA-F]{6}$/;

export interface ColourToggleProps {
  mode: ColourMode;
  templateColours: Record<ColourRole, string>;
  brandPackColours?: Partial<Record<ColourRole, string>> | null;
  resolvedColourMap: Record<ColourRole, string>;
  selectedRole?: ColourRole | null;
  onModeChange: (mode: ColourMode) => void;
  onColourChange: (role: ColourRole, value: string) => void;
  onResetColour: (role: ColourRole) => void;
  onSelectRole?: (role: ColourRole) => void;
}

/** Three explicit palette sources with validated, role-based manual editing. */
export function ColourToggle({
  mode,
  templateColours,
  brandPackColours = null,
  resolvedColourMap,
  selectedRole: controlledSelectedRole,
  onModeChange,
  onColourChange,
  onResetColour,
  onSelectRole,
}: ColourToggleProps) {
  const groupId = useId();
  const descriptionId = `${groupId}-description`;
  const [localSelectedRole, setLocalSelectedRole] = useState<ColourRole>("background");
  const [drafts, setDrafts] = useState<Record<ColourRole, string>>(() => ({ ...resolvedColourMap }));
  const selectedRole = controlledSelectedRole ?? localSelectedRole;
  const brandPackAvailable = !!brandPackColours && Object.keys(brandPackColours).length > 0;

  useEffect(() => setDrafts({ ...resolvedColourMap }), [resolvedColourMap]);
  const warnings = useMemo(() => colourContrastWarnings(resolvedColourMap), [resolvedColourMap]);

  const selectRole = (role: ColourRole) => {
    setLocalSelectedRole(role);
    onSelectRole?.(role);
  };

  const commitDraft = (role: ColourRole) => {
    const normalised = normaliseSixDigitHex(drafts[role]);
    if (!normalised) return;
    setDrafts(current => ({ ...current, [role]: normalised }));
    onColourChange(role, normalised);
  };

  return (
    <div className="space-y-4" aria-describedby={descriptionId}>
      <div>
        <div
          role="radiogroup"
          aria-labelledby={`${groupId}-label`}
          className="grid grid-cols-3 gap-1 rounded-(--r-card) border border-border bg-muted/40 p-1"
        >
          <span id={`${groupId}-label`} className="sr-only">Colour source</span>
          {MODES.map(option => {
            const disabled = option.value === "brand_pack" && !brandPackAvailable;
            const selected = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onModeChange(option.value)}
                className={`relative min-h-14 rounded-[calc(var(--r-card)-4px)] px-2 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selected
                    ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:bg-card/70 hover:text-foreground"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  {selected ? <Check aria-hidden className="size-3.5 text-primary" /> : null}
                  {option.label}
                </span>
                <span className="mt-0.5 block truncate text-[10px] leading-tight">{option.description}</span>
              </button>
            );
          })}
        </div>
        <p id={descriptionId} className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
          {brandPackAvailable
            ? "Switch palettes without losing your custom colours."
            : "Add workspace colours in Brand Studio to use the Brand Pack palette."}
        </p>
      </div>

      <PaletteStrip colours={resolvedColourMap} />

      {mode === "manual" ? (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Custom colour roles
          </legend>
          {COLOUR_ROLES.map(role => {
            const selected = selectedRole === role;
            const valid = !!normaliseSixDigitHex(drafts[role]);
            const inputId = `${groupId}-${role}`;
            return (
              <div
                key={role}
                className={`rounded-(--r-card) border p-2.5 transition ${
                  selected ? "border-primary/50 bg-primary/[0.04] shadow-sm" : "border-border bg-card"
                }`}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectRole(role)}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-(--r-ctl) text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden
                    className="size-8 shrink-0 rounded-full border border-black/10 shadow-inner"
                    style={{ backgroundColor: valid ? drafts[role] : resolvedColourMap[role] }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{ROLE_LABELS[role].label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{ROLE_LABELS[role].description}</span>
                  </span>
                </button>

                {selected ? (
                  <div className="mt-2 grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] gap-2 border-t border-border/70 pt-2">
                    <label htmlFor={`${inputId}-picker`} className="relative min-h-11 overflow-hidden rounded-(--r-ctl) border border-input" title={`Pick ${ROLE_LABELS[role].label}`}>
                      <span className="sr-only">Pick {ROLE_LABELS[role].label}</span>
                      <input
                        id={`${inputId}-picker`}
                        type="color"
                        value={normaliseSixDigitHex(drafts[role]) ?? normaliseSixDigitHex(resolvedColourMap[role]) ?? "#000000"}
                        onChange={event => {
                          setDrafts(current => ({ ...current, [role]: event.target.value.toUpperCase() }));
                          onColourChange(role, event.target.value.toUpperCase());
                        }}
                        className="absolute -inset-2 size-16 cursor-pointer border-0 bg-transparent p-0"
                      />
                    </label>
                    <label htmlFor={inputId} className="min-w-0">
                      <span className="sr-only">{ROLE_LABELS[role].label} hex colour</span>
                      <input
                        id={inputId}
                        type="text"
                        inputMode="text"
                        value={drafts[role]}
                        aria-invalid={!valid}
                        aria-describedby={!valid ? `${inputId}-error` : undefined}
                        maxLength={7}
                        onChange={event => setDrafts(current => ({ ...current, [role]: event.target.value }))}
                        onBlur={() => commitDraft(role)}
                        onKeyDown={event => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitDraft(role);
                            event.currentTarget.blur();
                          }
                        }}
                        className="min-h-11 w-full rounded-(--r-ctl) border border-input bg-background px-3 font-mono text-sm uppercase text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:border-destructive"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setDrafts(current => ({ ...current, [role]: templateColours[role] }));
                        onResetColour(role);
                      }}
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-(--r-ctl) border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Reset ${ROLE_LABELS[role].label} to template colour`}
                      title="Reset to template colour"
                    >
                      <RotateCcw aria-hidden className="size-4" />
                    </button>
                    {!valid ? (
                      <p id={`${inputId}-error`} role="alert" className="col-span-3 text-[11px] text-destructive">
                        Enter a six-digit hex colour such as #1A2B3C.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </fieldset>
      ) : null}

      {warnings.length > 0 ? (
        <div role="status" className="rounded-(--r-card) border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-amber-950">
          <div className="flex items-start gap-2">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="text-xs font-semibold">Some text may be hard to read</p>
              <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed">
                {warnings.map(warning => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
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
