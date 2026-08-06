"use client";

// Editor side panels (Track A, §7). shadcn primitives on the .tw bridge only.
// Guided mode: content + image controls + brand palette. Advanced adds the
// size/align steppers; studio (Template Studio, Track C) will reuse these
// with full typo controls layered on top.

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { AdDocInstance, AdTemplateDocV2 } from "@/lib/adstudio/v2/template-doc";
import {
  layerOverrides,
  templateLayer,
  textInputFor,
  type EditorMode,
} from "@/lib/adstudio/v2/editor-state.ts";
import type { EditorAction } from "@/lib/adstudio/v2/editor-state.ts";

export function EditorPanels({
  template,
  instance,
  mode,
  selectedLayerId,
  brandPalette,
  edit,
  denied,
}: {
  template: AdTemplateDocV2;
  instance: AdDocInstance;
  mode: EditorMode;
  selectedLayerId: string | null;
  brandPalette: string[];
  edit: (action: EditorAction, gestureId?: string) => void;
  denied: string | null;
}) {
  const layer = selectedLayerId ? templateLayer(template, selectedLayerId) : null;

  if (!layer) {
    return (
      <div className="flex flex-col gap-4 p-4 text-sm text-[var(--muted,#8a94a3)]">
        <p>Select a layer on the ad to edit it.</p>
        {denied ? <p role="alert" className="text-[var(--danger,#e5484d)]">{denied}</p> : null}
      </div>
    );
  }

  if (layer.type === "text") {
    const input = textInputFor(template, layer.inputKey);
    const value = instance.values.text[layer.inputKey] ?? "";
    const overrides = layerOverrides(instance, layer.id);
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`text-${layer.inputKey}`}>{input?.label ?? layer.inputKey}</Label>
          <Input
            id={`text-${layer.inputKey}`}
            value={value}
            maxLength={input?.maxLength}
            onChange={(event) => edit({ type: "set-text", key: layer.inputKey, value: event.target.value }, `type-${layer.inputKey}`)}
          />
          <small className="text-right text-[11px] text-[var(--muted,#8a94a3)]">
            {value.length}/{input?.maxLength ?? "—"}
          </small>
        </div>
        {mode !== "guided" ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => edit({ type: "override", layerId: layer.id, op: "align", align: "left", mode })}>Left</Button>
              <Button size="sm" variant="outline" onClick={() => edit({ type: "override", layerId: layer.id, op: "align", align: "center", mode })}>Center</Button>
              <Button size="sm" variant="outline" onClick={() => edit({ type: "override", layerId: layer.id, op: "align", align: "right", mode })}>Right</Button>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => edit({ type: "override", layerId: layer.id, op: "font-size", sizeRatio: Math.max(0.2, (overrides.sizeRatio ?? layer.typo.sizeRatio) - 0.05), mode })}>A−</Button>
              <Button size="sm" variant="outline" onClick={() => edit({ type: "override", layerId: layer.id, op: "font-size", sizeRatio: Math.min(1.2, (overrides.sizeRatio ?? layer.typo.sizeRatio) + 0.05), mode })}>A+</Button>
            </div>
          </div>
        ) : null}
        {brandPalette.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label>Colour{mode === "guided" ? " (brand palette)" : ""}</Label>
            <div className="flex flex-wrap gap-2">
              {brandPalette.map((colour) => (
                <button
                  key={colour}
                  type="button"
                  aria-label={`Set colour ${colour}`}
                  className="h-8 w-8 rounded-full border border-black/10"
                  style={{ background: colour }}
                  onClick={() => edit({ type: "override", layerId: layer.id, op: "color", color: colour, mode, palette: brandPalette })}
                />
              ))}
            </div>
          </div>
        ) : null}
        {denied ? <p role="alert" className="text-[var(--danger,#e5484d)] text-sm">{denied}</p> : null}
      </div>
    );
  }

  if (layer.type === "image_slot") {
    return <SlotPanel layer={layer} instance={instance} edit={edit} denied={denied} />;
  }

  return (
    <div className="p-4 text-sm text-[var(--muted,#8a94a3)]">
      Overlay patch{mode === "guided" ? " — locked in guided mode" : ""}.
    </div>
  );
}

function SlotPanel({
  layer,
  instance,
  edit,
  denied,
}: {
  layer: Extract<import("@/lib/adstudio/v2/template-doc").TemplateLayer, { type: "image_slot" }>;
  instance: AdDocInstance;
  edit: (action: EditorAction, gestureId?: string) => void;
  denied: string | null;
}) {
  const imageValue = instance.values.images[layer.inputKey];
  const [imageStatus, setImageStatus] = useState<"ok" | "low" | "none">("none");
  // Low-res guard (§7): warn when the customer photo falls below the slot's
  // declared minimum; the runtime hard floor lives in generate.ts.
  useEffect(() => {
    const src = imageValue?.src;
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      const min = layer.minSourcePx ?? { width: 540, height: 675 };
      setImageStatus(img.naturalWidth < min.width || img.naturalHeight < min.height ? "low" : "ok");
    };
    img.src = src.startsWith("data:") || src.startsWith("http") ? src : `/api/adstudio/media?path=${encodeURIComponent(src)}`;
  }, [imageValue?.src, layer.minSourcePx?.width, layer.minSourcePx?.height]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1.5">
        <Label>Zoom {Math.round((imageValue?.zoom ?? 1) * 100) / 100}×</Label>
        <Slider
          min={1}
          max={3}
          step={0.05}
          value={[imageValue?.zoom ?? 1]}
          onValueChange={([zoom]) =>
            edit({ type: "image-focal", key: layer.inputKey, focal: imageValue?.focal ?? layer.focal ?? { x: 0.5, y: 0.5 }, zoom }, `zoom-${layer.inputKey}`)
          }
        />
        <small className="text-[11px] text-[var(--muted,#8a94a3)]">
          Drag the photo to reposition. Replace it from your media library.
        </small>
        {imageStatus === "low" ? (
          <p role="alert" className="text-[13px] font-semibold text-[var(--danger,#e5484d)]">
            This photo is below the slot's minimum resolution — it may look soft in the published ad.
          </p>
        ) : null}
      </div>
      {denied ? <p role="alert" className="text-[var(--danger,#e5484d)] text-sm">{denied}</p> : null}
    </div>
  );
}
