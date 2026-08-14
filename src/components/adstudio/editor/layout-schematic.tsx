"use client";

import type { ReactElement } from "react";
import type { Layout, LayoutLayer, ImageSlotLayer, TemplatePack } from "../../../../packages/ad-template-pack-contract/src/types";
import { PLACEMENT_DIMENSIONS } from "../../../../packages/ad-template-pack-contract/src/types";

// ---------------------------------------------------------------------------
// LayoutSchematic — live SVG view of a pack layout's layers.
//
// Derived from the gallery LayoutThumb idea but interactive: every layer
// shape is clickable (onSelect) and the selected layer gets a highlight
// ring. Geometry and colours come from the real layout (layer.geometry +
// pack semanticColours) so the schematic always reflects the ACTIVE
// placement — pass the layout the editor currently shows (feed vs story).
// No Konva, no network images: image slots render as empty rects.
// ---------------------------------------------------------------------------

export interface LayoutSchematicProps {
  layout: Layout;
  colours: TemplatePack["semanticColours"];
  /** Layer id to highlight with a selection ring. */
  selectedLayerId?: string | null;
  /** Called when a layer shape is clicked. */
  onSelect?: (layerId: string) => void;
  /**
   * Called when an image slot is clicked (in addition to onSelect) — the
   * editor opens the per-placement crop dialog for that input.
   */
  onCropImage?: (layer: ImageSlotLayer) => void;
  /** SVG preserveAspectRatio — "meet" shows the whole ad (editor), "slice" fills a card (gallery thumb). */
  preserveAspectRatio?: string;
  className?: string;
}

export function LayoutSchematic({
  layout,
  colours,
  selectedLayerId,
  onSelect,
  onCropImage,
  preserveAspectRatio = "xMidYMid meet",
  className,
}: LayoutSchematicProps) {
  const dims = PLACEMENT_DIMENSIONS[layout.placement];
  const selected = selectedLayerId ? layout.layers.find(l => l.layerId === selectedLayerId) : null;

  return (
    <svg
      viewBox={`0 0 ${dims.width} ${dims.height}`}
      preserveAspectRatio={preserveAspectRatio}
      className={className}
      role={onSelect ? undefined : "img"}
      aria-label={`${layout.placement} layout schematic`}
    >
      {layout.layers.length === 0 ? (
        <rect x={0} y={0} width={dims.width} height={dims.height} fill="#f1f5f9" />
      ) : (
        layout.layers.map(layer => renderLayer(layer, colours, onSelect, onCropImage, dims))
      )}

      {/* Safe zones — dashed guide outlines, never block clicks */}
      {layout.safeZones.map((zone, index) => (
        <rect
          key={`safe-${index}`}
          x={zone.x}
          y={zone.y}
          width={zone.width}
          height={zone.height}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray="12 12"
          opacity="0.35"
          className="text-slate-400"
          pointerEvents="none"
        />
      ))}

      {/* Selection ring — drawn last so it sits above every layer */}
      {selected && (
        <rect
          x={selected.geometry.x - 3}
          y={selected.geometry.y - 3}
          width={selected.geometry.width + 6}
          height={selected.geometry.height + 6}
          fill="none"
          stroke="var(--ui-primary, #3b82f6)"
          strokeWidth={6}
          pointerEvents="none"
        />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Layer rendering — mirrors the gallery thumbnail's visual language
// ---------------------------------------------------------------------------

function renderLayer(
  layer: LayoutLayer,
  colours: TemplatePack["semanticColours"],
  onSelect: ((layerId: string) => void) | undefined,
  onCropImage: ((layer: ImageSlotLayer) => void) | undefined,
  dims: { width: number; height: number },
): ReactElement {
  const fill = (role: string) => colours[role as keyof TemplatePack["semanticColours"]] ?? "#cbd5e1";
  const g = layer.geometry ?? { x: 0, y: 0, width: dims.width, height: dims.height };
  const handlers = onSelect
    ? { onClick: () => onSelect(layer.layerId), className: "cursor-pointer hover:opacity-80" }
    : { className: "schematic-layer" };

  switch (layer.type) {
    case "plate":
      return (
        <rect
          key={layer.layerId}
          x={g.x}
          y={g.y}
          width={g.width}
          height={g.height}
          fill={fill(layer.colourRole)}
          {...handlers}
        />
      );
    case "image_slot": {
      // Clicking an image slot selects it AND opens the per-placement crop
      // dialog (when the editor wires onCropImage).
      const slotHandlers = onSelect
        ? {
            onClick: () => {
              onSelect(layer.layerId);
              onCropImage?.(layer);
            },
            className: "cursor-pointer hover:opacity-80",
            title: onCropImage ? "Crop image" : undefined,
          }
        : { className: "schematic-layer" };
      if (layer.mask === "circle") {
        const r = Math.min(g.width, g.height) / 2;
        return (
          <circle
            key={layer.layerId}
            cx={g.x + g.width / 2}
            cy={g.y + g.height / 2}
            r={r}
            fill="#ffffff"
            stroke="#94a3b8"
            strokeWidth={4}
            {...slotHandlers}
          />
        );
      }
      return (
        <rect
          key={layer.layerId}
          x={g.x}
          y={g.y}
          width={g.width}
          height={g.height}
          rx={layer.mask === "rounded_rect" ? Math.min(24, g.width / 4, g.height / 4) : 0}
          fill="#ffffff"
          stroke="#94a3b8"
          strokeWidth={4}
          {...slotHandlers}
        />
      );
    }
    case "overlay_patch":
      return (
        <rect
          key={layer.layerId}
          x={g.x}
          y={g.y}
          width={g.width}
          height={g.height}
          fill={fill(layer.colourRole)}
          opacity={Math.max(0.05, Math.min(1, layer.opacity))}
          {...handlers}
        />
      );
    case "text": {
      const boxFill = fill(layer.colourRole);
      return (
        <g key={layer.layerId} {...handlers}>
          <rect
            x={g.x}
            y={g.y}
            width={g.width}
            height={g.height}
            fill={boxFill}
            opacity="0.85"
          />
          {/* Input-key label when the box is big enough to hold one */}
          {g.width > 140 && g.height > 64 && (
            <text
              x={g.x + g.width / 2}
              y={g.y + g.height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={Math.min(48, g.height * 0.28)}
              fontWeight={600}
              fill={readableFill(boxFill)}
              pointerEvents="none"
            >
              {layer.inputKey}
            </text>
          )}
        </g>
      );
    }
    case "logo":
      return (
        <rect
          key={layer.layerId}
          x={g.x}
          y={g.y}
          width={g.width}
          height={g.height}
          fill={colours.primary ?? "#334155"}
          rx={Math.min(24, g.width / 4)}
          {...handlers}
        />
      );
  }
}

/** Pick a readable label colour (dark or white) for a given hex fill. */
function readableFill(fill: string): string {
  const hex = fill.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(hex)) return "#ffffff";
  const full = hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1e293b" : "#ffffff";
}
