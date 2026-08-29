"use client";

import type { ReactElement } from "react";
import type { Layout, LayoutLayer, ImageSlotLayer, TemplatePack, Rect } from "../../../../packages/ad-template-pack-contract/src/types";
import { PLACEMENT_DIMENSIONS } from "../../../../packages/ad-template-pack-contract/src/types";
import { normalizedImagePlacement, wrapSchematicText } from "../../../lib/adstudio/layout-schematic-preview";

// ---------------------------------------------------------------------------
// LayoutSchematic — live SVG view of a pack layout's layers.
//
// Derived from the gallery LayoutThumb idea but interactive: every layer
// shape is clickable (onSelect) and the selected layer gets a highlight
// ring. Geometry and colours come from the real layout (layer.geometry +
// pack semanticColours) so the schematic always reflects the ACTIVE
// placement — pass the layout the editor currently shows (feed vs story).
// No Konva: the preview stays a lightweight SVG and uses the same authenticated
// image URLs already held by the editor. It is intentionally still a preview;
// the server remains the authority for final PNG rendering.
// ---------------------------------------------------------------------------

export interface LayoutSchematicProps {
  layout: Layout;
  colours: TemplatePack["semanticColours"];
  /** Current customer image source per input key (data URL or auth-gated ref). */
  imageValues?: Record<string, string | null | undefined>;
  /** Current editable text per input key. Empty values render as empty boxes. */
  textValues?: Record<string, string | null | undefined>;
  /** Active placement crop overrides, normalized over each source image. */
  cropOverrides?: Record<string, Rect | null | undefined>;
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
  imageValues,
  textValues,
  cropOverrides,
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
        layout.layers.map(layer => renderLayer(
          layer,
          colours,
          onSelect,
          onCropImage,
          dims,
          imageValues,
          textValues,
          cropOverrides,
        ))
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
  imageValues: LayoutSchematicProps["imageValues"],
  textValues: LayoutSchematicProps["textValues"],
  cropOverrides: LayoutSchematicProps["cropOverrides"],
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
      const imageUrl = imageValues?.[layer.inputKey] ?? null;
      const crop = cropOverrides?.[layer.inputKey] ?? layer.defaultCrop;
      const imageBox = normalizedImagePlacement(g, crop);
      const clipId = `schematic-clip-${safeSvgId(layer.layerId)}`;
      const radius = layer.mask === "rounded_rect" ? Math.min(24, g.width / 4, g.height / 4) : 0;
      const r = Math.min(g.width, g.height) / 2;
      return (
        <g key={layer.layerId} {...slotHandlers}>
          <defs>
            <clipPath id={clipId}>
              {layer.mask === "circle" ? (
                <circle cx={g.x + g.width / 2} cy={g.y + g.height / 2} r={r} />
              ) : (
                <rect x={g.x} y={g.y} width={g.width} height={g.height} rx={radius} />
              )}
            </clipPath>
          </defs>
          {imageUrl ? (
            <image
              href={imageUrl}
              x={imageBox.x}
              y={imageBox.y}
              width={imageBox.width}
              height={imageBox.height}
              preserveAspectRatio="none"
              clipPath={`url(#${clipId})`}
              pointerEvents="none"
            />
          ) : layer.mask === "circle" ? (
            <circle cx={g.x + g.width / 2} cy={g.y + g.height / 2} r={r} fill="#ffffff" />
          ) : (
            <rect x={g.x} y={g.y} width={g.width} height={g.height} rx={radius} fill="#ffffff" />
          )}
          {layer.mask === "circle" ? (
            <circle cx={g.x + g.width / 2} cy={g.y + g.height / 2} r={r} fill="none" stroke="#94a3b8" strokeWidth={4} pointerEvents="none" />
          ) : (
            <rect x={g.x} y={g.y} width={g.width} height={g.height} rx={radius} fill="none" stroke="#94a3b8" strokeWidth={4} pointerEvents="none" />
          )}
        </g>
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
          {/* Render the current editor value; never expose internal input keys. */}
          {g.width > 80 && g.height > 32 && textValues?.[layer.inputKey]?.trim() && (
            <text
              x={textAnchorX(g, layer.alignment)}
              y={g.y + schematicFontSize(g)}
              textAnchor={svgTextAnchor(layer.alignment)}
              fontSize={schematicFontSize(g)}
              fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
              fontWeight={600}
              fill={readableFill(boxFill)}
              pointerEvents="none"
            >
              {wrapSchematicText(textValues?.[layer.inputKey] ?? "", layer.maxCharacters, layer.maxLines, g.width, schematicFontSize(g)).map((line, index) => (
                <tspan key={`${layer.layerId}-line-${index}`} x={textAnchorX(g, layer.alignment)} dy={index === 0 ? 0 : schematicFontSize(g) * 1.15}>
                  {line}
                </tspan>
              ))}
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
    case "vector":
      return layer.shape === "circle" ? (
        <circle key={layer.layerId} cx={g.x + g.width / 2} cy={g.y + g.height / 2} r={Math.min(g.width, g.height) / 2} fill={fill(layer.colourRole)} opacity={layer.opacity ?? 1} {...handlers} />
      ) : (
        <rect key={layer.layerId} x={g.x} y={g.y} width={g.width} height={g.height} rx={layer.shape === "pill" || layer.shape === "rounded" ? Math.min(24, g.height / 2) : 0} fill={fill(layer.colourRole)} opacity={layer.opacity ?? 1} {...handlers} />
      );
    case "icon":
      return <circle key={layer.layerId} cx={g.x + g.width / 2} cy={g.y + g.height / 2} r={Math.min(g.width, g.height) / 3} fill="none" stroke={fill(layer.colourRole)} strokeWidth={Math.max(2, Math.min(g.width, g.height) / 12)} {...handlers} />;
  }
}

function schematicFontSize(rect: Rect): number {
  return Math.max(14, Math.min(48, rect.height * 0.28));
}

function textAnchorX(rect: Rect, alignment: "left" | "center" | "right"): number {
  if (alignment === "left") return rect.x + Math.min(20, rect.width * 0.08);
  if (alignment === "right") return rect.x + rect.width - Math.min(20, rect.width * 0.08);
  return rect.x + rect.width / 2;
}

function svgTextAnchor(alignment: "left" | "center" | "right"): "start" | "middle" | "end" {
  if (alignment === "left") return "start";
  if (alignment === "right") return "end";
  return "middle";
}

function safeSvgId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
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
