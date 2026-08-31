"use client";

import { COLOUR_ROLES, type ColourRole } from "../../../../packages/ad-template-contract/src/types";
import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// Colour mode toggle — template palette vs workspace Brand Pack colours.
// Unchecked = template colours; checked = Brand Pack colours. Disabled when
// the workspace has no Brand Pack yet. The swatch strip previews the live
// resolved palette (the preview updates from the same map, so both move
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
  const switchId = useId();
  const descriptionId = `${switchId}-description`;
  return (
    <div className="space-y-1.5">
      <div
        className={`flex min-h-11 items-center gap-2 rounded-(--r-card) border border-border px-3 py-1.5 text-sm transition ${
          useBrandPack ? "bg-(--ui-primary)/10" : "bg-transparent"
        } ${brandPackAvailable ? "hover:bg-(--surface-subtle)" : "cursor-not-allowed opacity-60"}`}
        aria-describedby={descriptionId}
      >
        <Switch
          id={switchId}
          checked={useBrandPack}
          disabled={!brandPackAvailable}
          onCheckedChange={onToggle}
          aria-labelledby={`${switchId}-label`}
          aria-describedby={descriptionId}
        />
        <Label id={`${switchId}-label`} htmlFor={switchId} className="font-medium">
          Workspace colours
        </Label>
        <span className="flex items-center gap-1" aria-hidden="true">
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
      <p id={descriptionId} className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        {brandPackAvailable
          ? "Use your workspace colours instead of the template palette."
          : "Add workspace colours in Brand Studio to use them here."}
      </p>
    </div>
  );
}
