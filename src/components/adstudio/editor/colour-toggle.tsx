"use client";

import { COLOUR_ROLES, type ColourRole } from "../../../../packages/ad-template-pack-contract/src/types.js";

// ---------------------------------------------------------------------------
// Colour mode toggle — template palette vs workspace Brand Pack colours.
// Unchecked = template colours; checked = Brand Pack colours. Disabled when
// the workspace has no Brand Pack yet. The swatch strip previews the live
// resolved palette (the schematic updates from the same map, so both move
// together).
// ---------------------------------------------------------------------------

export interface ColourToggleProps {
  /** true = Brand Pack colours, false = template colours. */
  useBrandPack: boolean;
  /** Whether the workspace has a Brand Pack (disabled without one). */
  brandPackAvailable: boolean;
  /** Live resolved palette to preview as swatches. */
  resolvedColourMap: Record<ColourRole, string>;
  onToggle: (useBrandPack: boolean) => void;
}

export function ColourToggle({
  useBrandPack,
  brandPackAvailable,
  resolvedColourMap,
  onToggle,
}: ColourToggleProps) {
  return (
    <label
      className={`flex items-center gap-2 rounded-(--r-control) border border-(--line) px-3 py-1.5 text-sm transition ${
        useBrandPack ? "bg-(--ui-primary)/10" : "bg-transparent"
      } ${brandPackAvailable ? "cursor-pointer hover:bg-(--surface-subtle)" : "cursor-not-allowed opacity-60"}`}
      title={
        brandPackAvailable
          ? "Use your Brand Pack colours in place of the template palette"
          : "No Brand Pack yet — add one in Brand Studio"
      }
    >
      <input
        type="checkbox"
        checked={useBrandPack}
        disabled={!brandPackAvailable}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-4 w-4 accent-(--ui-primary)"
      />
      <span className="font-medium text-foreground">Brand Pack colours</span>
      <span className="flex items-center gap-1" aria-hidden="true">
        {COLOUR_ROLES.map((role) => (
          <span
            key={role}
            className="h-3 w-3 rounded-full border border-black/10"
            style={{ backgroundColor: resolvedColourMap[role] ?? "#cccccc" }}
            title={role}
          />
        ))}
      </span>
    </label>
  );
}
