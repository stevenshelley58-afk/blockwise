"use client";

// Konva canvas for the v2 editor (Track A, §7). The editor PREVIEWs the doc;
// canonical pixels always come from the server render (parity gate §4 binds
// the browser render-doc to the server), so the canvas approximates with the
// same typography math, never defines truth.

import { useMemo, useRef, useState } from "react";
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text } from "react-konva";
import useImage from "use-image";

import { useAssetUrl } from "./use-asset-url";
import { TextEditOverlay } from "./text-edit-overlay";
import { focalCoverSourceRect } from "@/lib/adstudio/v2/render/cover-crop.ts";
import type {
  AdDocInstance,
  AdTemplateDocV2,
  ImageSlotLayer,
  OverlayPatchLayer,
  TextLayer,
} from "@/lib/adstudio/v2/template-doc";
import { layerOverrides, type EditorMode } from "@/lib/adstudio/v2/editor-state.ts";

type EditorCanvasProps = {
  template: AdTemplateDocV2;
  instance: AdDocInstance;
  mode: EditorMode;
  /** Layout to show; format tabs live in the toolbar. */
  format: "4:5" | "9:16";
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string | null) => void;
  onMoveLayer: (layerId: string, box: { x: number; y: number; width: number; height: number }, gestureId: string) => void;
  onOpenTextEditor: (layerId: string) => void;
  editingTextId: string | null;
  onCommitTextEdit: (layer: TextLayer, value: string) => void;
  onCancelTextEdit: () => void;
  editingInput?: { maxLength: number } | undefined;
  stageScale: number;
  width: number;
  height: number;
};

function fontString(layer: TextLayer, fontSize: number): string {
  const style = `${layer.typo.italic ? "italic " : ""}${layer.typo.weight} ${Math.round(fontSize)}px "${layer.typo.family}", ${layer.typo.fallbackFamily}`;
  return style;
}

function PlateAndSlots({
  template,
  instance,
  layout,
  mode,
  selectedLayerId,
  onSelectLayer,
  onMoveLayer,
  onOpenTextEditor,
}: {
  template: AdTemplateDocV2;
  instance: AdDocInstance;
  layout: NonNullable<AdTemplateDocV2["formats"]["feed"]>;
  mode: EditorMode;
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onMoveLayer: EditorCanvasProps["onMoveLayer"];
  onOpenTextEditor: (id: string) => void;
}) {
  return (
    <>
      <PlateImage src={layout.plate.src} width={layout.width} height={layout.height} />
      {[...layout.layers]
        .sort((a, b) => a.z - b.z)
        .map((layer) => {
          const overrides = layerOverrides(instance, layer.id);
          const box = overrides.box ?? layer.box;
          const left = box.x * layout.width;
          const top = box.y * layout.height;
          const width = box.width * layout.width;
          const height = box.height * layout.height;
          const selected = selectedLayerId === layer.id;

          if (layer.type === "image_slot") {
            return (
              <SlotNode
                key={layer.id}
                layer={layer}
                instance={instance}
                left={left}
                top={top}
                width={width}
                height={height}
                mode={mode}
                selected={selected}
                onSelectLayer={onSelectLayer}
                onMoveLayer={onMoveLayer}
              />
            );
          }
          if (layer.type === "overlay_patch") {
            return (
              <PatchNode
                key={layer.id}
                layer={layer}
                left={left}
                top={top}
                width={width}
                height={height}
                selected={selected}
                mode={mode}
                onSelectLayer={onSelectLayer}
                onMoveLayer={onMoveLayer}
              />
            );
          }
          return (
            <TextNode
              key={layer.id}
              layer={layer}
              instance={instance}
              colorOverride={overrides.color}
              sizeRatioOverride={overrides.sizeRatio}
              alignOverride={overrides.align}
              left={left}
              top={top}
              width={width}
              height={height}
              selected={selected}
              mode={mode}
              onSelectLayer={onSelectLayer}
              onOpenTextEditor={onOpenTextEditor}
            />
          );
        })}
    </>
  );
}

function PlateImage({ src, width, height }: { src: string; width: number; height: number }) {
  const url = useAssetUrl(src);
  const [image] = useImage(url ?? "");
  return image ? <KonvaImage image={image} x={0} y={0} width={width} height={height} listening={false} /> : null;
}

function SlotNode({
  layer,
  instance,
  left,
  top,
  width,
  height,
  mode,
  selected,
  onSelectLayer,
  onMoveLayer,
}: {
  layer: ImageSlotLayer;
  instance: AdDocInstance;
  left: number;
  top: number;
  width: number;
  height: number;
  mode: EditorMode;
  selected: boolean;
  onSelectLayer: (id: string | null) => void;
  onMoveLayer: EditorCanvasProps["onMoveLayer"];
}) {
  const src = instance.values.images[layer.inputKey]?.src;
  const url = src ? (src.startsWith("data:") || src.startsWith("http") ? src : `/api/adstudio/media?path=${encodeURIComponent(src)}`) : null;
  const [image] = useImage(url ?? "");
  const focal = instance.values.images[layer.inputKey]?.focal ?? layer.focal ?? { x: 0.5, y: 0.5 };
  const zoom = instance.values.images[layer.inputKey]?.zoom ?? 1;

  const srcRect = image
    ? focalCoverSourceRect({ slotWidthPx: width, slotHeightPx: height, imageWidth: image.width, imageHeight: image.height, focal, zoom })
    : null;

  const draggable = mode !== "guided";

  return (
    <Group
      x={left}
      y={top}
      draggable={draggable}
      onDragEnd={(event) => {
        const node = event.target;
        onMoveLayer(layer.id, { x: node.x() / 1080, y: node.y() / 1350, width, height }, `drag-${layer.id}`);
        node.position({ x: left, y: top });
      }}
      onTap={() => onSelectLayer(layer.id)}
      onClick={() => onSelectLayer(layer.id)}
    >
      {image && srcRect ? (
        <KonvaImage
          image={image}
          x={0}
          y={0}
          width={width}
          height={height}
          crop={{ x: srcRect.sx, y: srcRect.sy, width: srcRect.sw, height: srcRect.sh }}
          cornerRadius={layer.mask.kind === "rounded" ? layer.mask.radius ?? 24 : layer.mask.kind === "ellipse" ? height / 2 : 0}
        />
      ) : (
        <Rect width={width} height={height} fill="#22303f" opacity={0.5} />
      )}
      {selected ? (
        <Rect width={width} height={height} stroke="#2f7cf6" strokeWidth={3} listening={false} />
      ) : mode === "guided" ? null : null}
    </Group>
  );
}

function PatchNode({
  layer,
  left,
  top,
  width,
  height,
  selected,
  mode,
  onSelectLayer,
  onMoveLayer,
}: {
  layer: OverlayPatchLayer;
  left: number;
  top: number;
  width: number;
  height: number;
  selected: boolean;
  mode: EditorMode;
  onSelectLayer: (id: string | null) => void;
  onMoveLayer: EditorCanvasProps["onMoveLayer"];
}) {
  const url = useAssetUrl(layer.src);
  const [image] = useImage(url ?? "");
  const draggable = mode !== "guided";
  return (
    <Group
      x={left}
      y={top}
      draggable={draggable}
      onDragEnd={(event) => {
        const node = event.target;
        onMoveLayer(layer.id, { x: node.x() / 1080, y: node.y() / 1350, width, height }, `drag-${layer.id}`);
        node.position({ x: left, y: top });
      }}
      onTap={() => onSelectLayer(layer.id)}
      onClick={() => onSelectLayer(layer.id)}
    >
      {image ? <KonvaImage image={image} width={width} height={height} /> : null}
      {selected ? <Rect width={width} height={height} stroke="#2f7cf6" strokeWidth={3} listening={false} /> : null}
    </Group>
  );
}

function TextNode({
  layer,
  instance,
  colorOverride,
  sizeRatioOverride,
  alignOverride,
  left,
  top,
  width,
  height,
  selected,
  mode,
  onSelectLayer,
  onOpenTextEditor,
}: {
  layer: TextLayer;
  instance: AdDocInstance;
  colorOverride?: string;
  sizeRatioOverride?: number;
  alignOverride?: "left" | "center" | "right";
  left: number;
  top: number;
  width: number;
  height: number;
  selected: boolean;
  mode: EditorMode;
  onSelectLayer: (id: string | null) => void;
  onOpenTextEditor: (id: string) => void;
}) {
  const text = instance.values.text[layer.inputKey] ?? "";
  const sizeRatio = sizeRatioOverride ?? layer.typo.sizeRatio;
  const fontSize = height * sizeRatio;
  const effects = layer.typo.effects;
  const gradient = effects?.gradientFill;

  return (
    <Group x={left} y={top} onTap={() => onSelectLayer(layer.id)} onClick={() => onSelectLayer(layer.id)}
      onDblClick={() => onOpenTextEditor(layer.id)} onDblTap={() => onOpenTextEditor(layer.id)}>
      <Text
        text={text}
        width={width}
        height={height}
        verticalAlign="middle"
        align={alignOverride ?? layer.typo.align}
        fontFamily={layer.typo.family}
        fontStyle={`${layer.typo.italic ? "italic " : ""}${layer.typo.weight}`}
        fontSize={fontSize}
        lineHeight={layer.typo.lineHeight}
        letterSpacing={layer.typo.tracking * fontSize}
        fill={gradient ? undefined : (colorOverride ?? layer.typo.color)}
        {...(gradient
          ? {
              fillLinearGradientStartPoint: { x: 0, y: 0 },
              fillLinearGradientEndPoint: { x: width, y: gradient.angleDeg === 90 ? height : 0 },
              fillLinearGradientColorStops: [0, gradient.from, 1, gradient.to],
            }
          : {})}
        {...(effects?.stroke ? { stroke: effects.stroke.color, strokeWidth: effects.stroke.widthRatio * height } : {})}
        {...(effects?.shadow
          ? {
              shadowColor: effects.shadow.color,
              shadowBlur: effects.shadow.blurRatio * height,
              shadowOffsetX: effects.shadow.dx * width,
              shadowOffsetY: effects.shadow.dy * height,
              shadowEnabled: true,
            }
          : {})}
      />
      {selected || mode === "guided" ? (
        <Rect
          width={width}
          height={height}
          stroke={selected ? "#2f7cf6" : "transparent"}
          strokeWidth={selected ? 3 : 0}
          hitStrokeWidth={44}
          listening={true}
        />
      ) : null}
    </Group>
  );
}

export function EditorCanvas(props: EditorCanvasProps) {
  const { template, instance, format, stageScale, width, height } = props;
  const layout = format === "9:16" ? template.formats.story : template.formats.feed;
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

  const content = useMemo(
    () => (layout ? (
      <PlateAndSlots
        template={template}
        instance={instance}
        layout={layout}
        mode={props.mode}
        selectedLayerId={props.selectedLayerId}
        onSelectLayer={props.onSelectLayer}
        onMoveLayer={props.onMoveLayer}
        onOpenTextEditor={props.onOpenTextEditor}
      />
    ) : null),
    [layout, instance, props.mode, props.selectedLayerId, props.onSelectLayer, props.onMoveLayer, props.onOpenTextEditor, template],
  );

  if (!layout) return null;

  const editingLayer = props.editingTextId
    ? (layout.layers.find((layer) => layer.id === props.editingTextId && layer.type === "text") as TextLayer | undefined)
    : undefined;

  return (
    <Stage
      width={width}
      height={height}
      scaleX={stageScale * (width / layout.width)}
      scaleY={stageScale * (width / layout.width)}
      x={stagePos.x}
      y={stagePos.y}
      draggable={stageScale > 1}
      onDragEnd={(event) => {
        const target = event.target as unknown as { x(): number; y(): number };
        setStagePos({ x: target.x(), y: target.y() });
      }}
      onClick={() => props.onSelectLayer(null)}
      className="bg-[#0b0e12]"
    >
      <Layer>
        {content}
        {editingLayer ? (() => {
          const overrides = layerOverrides(instance, editingLayer.id);
          const box = overrides.box ?? editingLayer.box;
          return (
            <TextEditOverlay
              x={box.x * layout.width * (width / layout.width) * stageScale + stagePos.x}
              y={box.y * layout.height * (width / layout.width) * stageScale + stagePos.y}
              width={box.width * width * stageScale}
              height={box.height * layout.height * stageScale}
              value={instance.values.text[editingLayer.inputKey] ?? ""}
              maxLength={props.editingInput?.maxLength ?? 60}
              align={overrides.align ?? editingLayer.typo.align}
              fontSize={box.height * layout.height * (overrides.sizeRatio ?? editingLayer.typo.sizeRatio) * (width / layout.width) * stageScale}
              fontFamily={editingLayer.typo.family}
              onCommit={(value) => props.onCommitTextEdit(editingLayer, value)}
              onCancel={props.onCancelTextEdit}
            />
          );
        })() : null}
      </Layer>
    </Stage>
  );
}
