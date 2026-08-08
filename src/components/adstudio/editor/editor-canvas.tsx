"use client";

// Customer editing is always drawn over the latest canonical server render.
// Raw plates and patches never enter the browser; transparent hitboxes retain
// selection, text movement and image focal positioning without duplicating
// the renderer or exposing source-derived pixels.

import { useMemo, useState } from "react";
import { Group, Image as KonvaImage, Layer, Rect, Stage } from "react-konva";
import useImage from "use-image";

import { layoutPixelsToNormBox } from "./geometry";
import { TextEditOverlay } from "./text-edit-overlay";
import { layerOverrides, type EditorMode } from "@/lib/adstudio/v2/editor-state.ts";
import type {
  AdDocInstance,
  AdTemplateDocV2,
  NormBox,
  TextLayer,
} from "@/lib/adstudio/v2/template-doc";

type EditorCanvasProps = {
  template: AdTemplateDocV2;
  instance: AdDocInstance;
  mode: EditorMode;
  format: "4:5" | "9:16";
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string | null) => void;
  onMoveLayer: (layerId: string, box: NormBox, gestureId: string) => void;
  onAdjustImageFocal: (key: string, focal: { x: number; y: number }, gestureId: string) => void;
  onOpenTextEditor: (layerId: string) => void;
  editingTextId: string | null;
  onCommitTextEdit: (layer: TextLayer, value: string) => void;
  onCancelTextEdit: () => void;
  editingInput?: { maxLength: number } | undefined;
  stageScale: number;
  width: number;
  height: number;
  /** Workspace-scoped URL for the latest finished server render. */
  renderSrc?: string;
};

function CanonicalRender({ src, width, height }: { src?: string; width: number; height: number }) {
  // Fail closed if a future caller accidentally passes a logical template
  // asset. The customer canvas accepts only the authenticated media gateway.
  const url = src?.startsWith("/api/adstudio/media?path=") ? src : "";
  const [image] = useImage(url);
  return image
    ? <KonvaImage image={image} x={0} y={0} width={width} height={height} listening={false} />
    : <Rect width={width} height={height} fill="#121820" listening={false} />;
}

function LayerHitbox({
  layer,
  layout,
  left,
  top,
  width,
  height,
  selected,
  draggable,
  imageFocal,
  onSelectLayer,
  onMoveLayer,
  onAdjustImageFocal,
  onOpenTextEditor,
}: {
  layer: NonNullable<AdTemplateDocV2["formats"]["feed"]>["layers"][number];
  layout: { width: number; height: number };
  left: number;
  top: number;
  width: number;
  height: number;
  selected: boolean;
  draggable: boolean;
  imageFocal?: { x: number; y: number };
  onSelectLayer: (id: string | null) => void;
  onMoveLayer: EditorCanvasProps["onMoveLayer"];
  onAdjustImageFocal: EditorCanvasProps["onAdjustImageFocal"];
  onOpenTextEditor: (id: string) => void;
}) {
  return (
    <Group
      x={left}
      y={top}
      draggable={draggable}
      onDragEnd={(event) => {
        if (!draggable) return;
        const node = event.target;
        const gestureId = `drag-${layer.id}`;
        if (layer.type === "image_slot") {
          const focal = imageFocal ?? layer.focal ?? { x: 0.5, y: 0.5 };
          onAdjustImageFocal(
            layer.inputKey,
            {
              x: Math.min(1, Math.max(0, focal.x - (node.x() - left) / layout.width)),
              y: Math.min(1, Math.max(0, focal.y - (node.y() - top) / layout.height)),
            },
            gestureId,
          );
        } else {
          onMoveLayer(
            layer.id,
            layoutPixelsToNormBox(layout, { x: node.x(), y: node.y(), width, height }),
            gestureId,
          );
        }
        node.position({ x: left, y: top });
      }}
      onTap={() => onSelectLayer(layer.id)}
      onClick={() => onSelectLayer(layer.id)}
      onDblClick={() => layer.type === "text" && onOpenTextEditor(layer.id)}
      onDblTap={() => layer.type === "text" && onOpenTextEditor(layer.id)}
    >
      <Rect
        width={width}
        height={height}
        fill="rgba(0,0,0,0.001)"
        stroke={selected ? "#2f7cf6" : "transparent"}
        strokeWidth={selected ? 3 : 0}
        hitStrokeWidth={44}
      />
    </Group>
  );
}

export function EditorCanvas(props: EditorCanvasProps) {
  const { template, instance, format, stageScale, width, height } = props;
  const layout = format === "9:16" ? template.formats.story : template.formats.feed;
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

  const content = useMemo(
    () => (layout ? (
      <>
        <CanonicalRender src={props.renderSrc} width={layout.width} height={layout.height} />
        {[...layout.layers]
          .sort((a, b) => a.z - b.z)
          .map((layer) => {
            const overrides = layerOverrides(instance, layer.id);
            const box = overrides.box ?? layer.box;
            return (
              <LayerHitbox
                key={layer.id}
                layer={layer}
                layout={layout}
                left={box.x * layout.width}
                top={box.y * layout.height}
                width={box.width * layout.width}
                height={box.height * layout.height}
                selected={props.selectedLayerId === layer.id}
                draggable={layer.type === "image_slot" || (layer.type === "text" && !template.editPolicy.lockedLayerIds.includes(layer.id) && props.mode !== "guided")}
                imageFocal={layer.type === "image_slot"
                  ? instance.values.images[layer.inputKey]?.focal ?? layer.focal ?? { x: 0.5, y: 0.5 }
                  : undefined}
                onSelectLayer={props.onSelectLayer}
                onMoveLayer={props.onMoveLayer}
                onAdjustImageFocal={props.onAdjustImageFocal}
                onOpenTextEditor={props.onOpenTextEditor}
              />
            );
          })}
      </>
    ) : null),
    [
      instance,
      layout,
      props.mode,
      props.onAdjustImageFocal,
      props.onMoveLayer,
      props.onOpenTextEditor,
      props.onSelectLayer,
      props.renderSrc,
      props.selectedLayerId,
    ],
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
