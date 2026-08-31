"use client";

import { COLOUR_ROLES, type ColourRole } from "../../../../packages/ad-template-pack-contract/src/types";
import type { BrandPackColours, EditorState } from "./use-editor-state";
import { brandPackColoursToRoleMap, resolveColourMap } from "./use-editor-state";

// ---------------------------------------------------------------------------
// Colour panel — three mutually exclusive modes:
//   1. Template colours  — the pack's designed palette.
//   2. Brand Pack colours — the workspace Brand Kit palette (when one exists).
//   3. Custom colours    — a per-role picker + hex field for every role.
// Selecting a mode resolves the live palette immediately (the canvas, the
// previews and the saved document all read the same resolvedColourMap).
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<ColourRole, string> = {
  background: "Background",
  primary: "Primary",
  secondary: "Secondary",
  accent: "Accent",
  mainText: "Main text",
  inverseText: "Inverse text",
};

export interface ColourPanelProps {
  colourMode: EditorState["colourMode"];
  templateColours: Record<ColourRole, string>;
  brandColours: BrandPackColours | null;
  resolvedColourMap: Record<ColourRole, string>;
  onSelectMode: (mode: EditorState["colourMode"]) => void;
  onChangeCustomRole: (role: ColourRole, hex: string) => void;
}

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function ColourPanel({
  colourMode,
  templateColours,
  brandColours,
  resolvedColourMap,
  onSelectMode,
  onChangeCustomRole,
}: ColourPanelProps) {
  const brandMap = brandPackColoursToRoleMap(brandColours);
  const custom = colourMode === "custom";

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Choose where the design&apos;s colours come from. The canvas and previews
        update immediately.
      </p>

      <div role="radiogroup" aria-label="Colour mode" className="space-y-2">
        <ModeOption
          selected={colourMode === "template"}
          title="Template colours"
          description="The palette this template was designed with."
          swatches={templateColours}
          onSelect={() => onSelectMode("template")}
        />
        <ModeOption
          selected={colourMode === "brand_pack"}
          disabled={!brandColours}
          title="Brand Pack colours"
          description={brandColours ? "The palette from your Brand Pack." : "No Brand Pack yet — add one in Brand Studio."}
          swatches={resolveColourMap(templateColours, "brand_pack", brandMap)}
          onSelect={() => onSelectMode("brand_pack")}
        />
        <ModeOption
          selected={custom}
          title="Custom colours"
          description="Pick each colour yourself, role by role."
          swatches={resolvedColourMap}
          onSelect={() => onSelectMode("custom")}
        />
      </div>

      {custom && (
        <section aria-label="Custom colours" className="space-y-3 rounded-(--r-control) border border-(--line) p-3">
          {COLOUR_ROLES.map((role) => {
            const hex = resolvedColourMap[role] ?? "#cccccc";
            return (
              <div key={role} className="flex items-center gap-2">
                <input
                  type="color"
                  value={normalizeHex(hex)}
                  onChange={(e) => onChangeCustomRole(role, e.target.value)}
                  className="h-8 w-8 shrink-0 cursor-pointer rounded border border-(--line) bg-transparent"
                  aria-label={`${ROLE_LABELS[role]} colour picker`}
                />
                <label className="flex-1 text-sm font-medium text-foreground">
                  {ROLE_LABELS[role]}
                  <input
                    type="text"
                    value={hex}
                    onChange={(e) => {
                      const value = e.target.value.trim();
                      if (HEX_COLOUR.test(value)) onChangeCustomRole(role, value.startsWith("#") ? value : `#${value}`);
                    }}
                    maxLength={9}
                    spellCheck={false}
                    className="mt-0.5 block w-full rounded-(--r-control) border border-(--line) bg-(--surface-subtle) px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-(--ui-primary)"
                    aria-label={`${ROLE_LABELS[role]} hex value`}
                  />
                </label>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

function ModeOption({
  selected,
  disabled = false,
  title,
  description,
  swatches,
  onSelect,
}: {
  selected: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  swatches: Record<ColourRole, string>;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-(--r-control) border px-3 py-2.5 text-left transition ${
        selected
          ? "border-(--ui-primary) bg-(--ui-primary)/10"
          : "border-(--line) hover:bg-(--surface-subtle)"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? "border-(--ui-primary)" : "border-(--line)"
        }`}
        aria-hidden="true"
      >
        {selected && <span className="h-2 w-2 rounded-full bg-(--ui-primary)" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5" aria-hidden="true">
        {COLOUR_ROLES.map((role) => (
          <span
            key={role}
            className="h-3 w-3 rounded-full border border-black/10"
            style={{ backgroundColor: swatches[role] ?? "#cccccc" }}
          />
        ))}
      </span>
    </button>
  );
}

/** Normalize a hex colour for <input type="color"> (#rgb/#rrggbb only). */
function normalizeHex(hex: string): string {
  const clean = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(clean)) return `#${clean.split("").map((c) => c + c).join("")}`;
  if (/^[0-9a-fA-F]{6}$/.test(clean)) return `#${clean}`;
  return "#cccccc";
}
