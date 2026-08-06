"use client";

// EditorRoot (Track A, §7): owns doc state via useEditorDoc, renders the
// Konva canvas + toolbar + side panel (Sheet on mobile), and autosaves
// through the /doc route. Guided/advanced/studio modes per the template's
// editPolicy.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { AdDocInstance, AdTemplateDocV2 } from "@/lib/adstudio/v2/template-doc";

import { EditorCanvas } from "./editor-canvas";
import { EditorPanels } from "./panels";
import { EditorToolbar } from "./toolbar";
import { useEditorDoc } from "./state/use-editor-doc";

export type EditorRootProps = {
  template: AdTemplateDocV2;
  instance: AdDocInstance;
  mode?: "guided" | "advanced" | "studio";
  brandPalette?: string[];
  onSave?: (instance: AdDocInstance) => Promise<void> | void;
};

export function EditorRoot({ template, instance, mode = "guided", brandPalette = [], onSave }: EditorRootProps) {
  const editor = useEditorDoc({ template, instance, mode, brandPalette, onSave });
  const [format, setFormat] = useState<"4:5" | "9:16">(instance.format === "9:16" ? "9:16" : "4:5");
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
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

  const onMoveLayer = useCallback(
    (layerId: string, box: { x: number; y: number; width: number; height: number }, gestureId: string) => {
      editor.edit(
        {
          type: "override",
          layerId,
          op: "move",
          box: {
            x: Math.min(0.95, Math.max(0.0, box.x / 1080)),
            y: Math.min(0.95, Math.max(0.0, box.y / 1350)),
            width: Math.min(1, Math.max(0.05, box.width / 1080)),
            height: Math.min(1, Math.max(0.05, box.height / 1350)),
          },
          mode: editor.mode,
        },
        gestureId,
      );
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
      <div className="flex min-h-0 flex-1">
        <div
          ref={containerRef}
          className="flex min-w-0 flex-1 items-center justify-center overflow-hidden p-3"
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
              stageScale={zoom}
              width={stageWidth}
              height={stageHeight}
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
