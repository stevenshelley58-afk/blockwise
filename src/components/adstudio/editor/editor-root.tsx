"use client";

// EditorRoot (Track A, §7): owns doc state via useEditorDoc, renders the
// Konva canvas + toolbar + side panel (Sheet on mobile), and autosaves
// through the /doc route. Guided/advanced/studio modes per the template's
// editPolicy.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { AdDocInstance, AdTemplateDocV2, NormBox } from "@/lib/adstudio/v2/template-doc";

import { EditorCanvas } from "./editor-canvas";
import { clampEditorNormBox } from "./geometry";
import { EditorPanels } from "./panels";
import { EditorToolbar } from "./toolbar";
import { useEditorDoc } from "./state/use-editor-doc";

export type EditorRootProps = {
  template: AdTemplateDocV2;
  instance: AdDocInstance;
  mode?: "guided" | "advanced" | "studio";
  brandPalette?: string[];
  onSave?: (instance: AdDocInstance) => Promise<void> | void;
  renderSrcByFormat?: Partial<Record<"4:5" | "9:16", string>>;
};

export function EditorRoot({ template, instance, mode = "guided", brandPalette = [], onSave, renderSrcByFormat = {} }: EditorRootProps) {
  const editor = useEditorDoc({ template, instance, mode, brandPalette, onSave });
  const [format, setFormat] = useState<"4:5" | "9:16">(instance.format === "9:16" ? "9:16" : "4:5");
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 540, height: 675 });

  // Fit the stage to its container (device-pixel aware via CSS scaling).
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      setContainerSize({ width: node.clientWidth, height: node.clientHeight });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const layout = format === "9:16" ? template.formats.story : template.formats.feed;
  const aspect = layout ? layout.height / layout.width : 1.25;
  const stageWidth = Math.min(containerSize.width, (containerSize.height - 8) / aspect);
  const stageHeight = stageWidth * aspect;

  // A11y contract (parity with the in-place editor): arrow keys walk the
  // layers in z order, Escape cancels/deselects, Enter opens the text
  // overlay on the selected text layer.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (editingTextId) return; // the textarea owns keys while open
    const layers = layout ? [...layout.layers].sort((a, b) => a.z - b.z) : [];
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      if (layers.length === 0) return;
      const index = layers.findIndex((layer) => layer.id === selectedLayerId);
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const next = layers[(index + delta + layers.length) % layers.length];
      setSelectedLayerId(next.id);
    } else if (event.key === "Escape") {
      setSelectedLayerId(null);
    } else if (event.key === "Enter") {
      const layer = layers.find((candidate) => candidate.id === selectedLayerId);
      if (layer?.type === "text") setEditingTextId(layer.id);
    }
  };

  const editingLayer = layout?.layers.find((layer) => layer.id === editingTextId && layer.type === "text");
  const editingInput = editingLayer?.type === "text"
    ? template.inputs.text.find((input) => input.key === editingLayer.inputKey)
    : undefined;

  const onMoveLayer = useCallback(
    (layerId: string, box: NormBox, gestureId: string) => {
      editor.edit(
        {
          type: "override",
          layerId,
          op: "move",
          box: clampEditorNormBox(box),
          mode: editor.mode,
        },
        gestureId,
      );
    },
    [editor],
  );

  const onAdjustImageFocal = useCallback(
    (key: string, focal: { x: number; y: number }, gestureId: string) => {
      editor.edit({ type: "image-focal", key, focal }, gestureId);
    },
    [editor],
  );

  const panel = useMemo(
    () => (
      <EditorPanels
        template={template}
        instance={editor.instance}
        mode={editor.mode}
        selectedLayerId={selectedLayerId}
        brandPalette={brandPalette}
        edit={editor.edit}
        denied={editor.denied}
      />
    ),
    [template, editor.instance, editor.mode, editor.edit, editor.denied, selectedLayerId, brandPalette],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--panel,#12161c)]">
      <EditorToolbar
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        onUndo={editor.undo}
        onRedo={editor.redo}
        format={format}
        onFormatChange={setFormat}
        hasStory={Boolean(template.formats.story)}
        mode={editor.mode}
        onModeChange={editor.setMode}
        advancedUnlockable={template.editPolicy.advancedUnlockable}
        saving={editor.saving}
        dirty={editor.dirty}
        zoom={zoom}
        onZoomChange={setZoom}
      />
      {editor.saveError && (
        <p role="alert" className="m-0 border-b border-[var(--danger,#e5484d)] bg-[color-mix(in_srgb,var(--danger,#e5484d)_12%,transparent)] px-3 py-2 text-sm text-[var(--danger,#e5484d)]">
          {editor.saveError} Your latest changes are still here; retry by editing again.
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div
          ref={containerRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          aria-label="Ad editor canvas. Arrow keys walk layers, Enter edits text, Escape deselects."
          className="flex min-w-0 flex-1 items-center justify-center overflow-hidden p-3 focus:outline-none"
        >
          {layout ? (
            <EditorCanvas
              template={template}
              instance={editor.instance}
              mode={editor.mode}
              format={format}
              selectedLayerId={selectedLayerId}
              onSelectLayer={setSelectedLayerId}
              onMoveLayer={onMoveLayer}
              onAdjustImageFocal={onAdjustImageFocal}
              onOpenTextEditor={(layerId) => setEditingTextId(layerId)}
              editingTextId={editingTextId}
              onCommitTextEdit={(layer, value) => {
                editor.edit({ type: "set-text", key: layer.inputKey, value }, `text-${layer.id}`);
                setEditingTextId(null);
              }}
              onCancelTextEdit={() => setEditingTextId(null)}
              editingInput={editingInput}
              stageScale={zoom}
              width={stageWidth}
              height={stageHeight}
              renderSrc={renderSrcByFormat[format]}
            />
          ) : (
            <p className="text-sm text-[var(--muted,#8a94a3)]">No {format} layout on this template.</p>
          )}
        </div>
        <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-[var(--line-soft,#2a313b)] md:block">
          {panel}
        </aside>
        <div className="md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline" className="fixed bottom-4 right-4 z-20">
                Edit layer
              </Button>
            </SheetTrigger>
            <SheetContent side="right">{panel}</SheetContent>
          </Sheet>
        </div>
      </div>
    </div>
  );
}
