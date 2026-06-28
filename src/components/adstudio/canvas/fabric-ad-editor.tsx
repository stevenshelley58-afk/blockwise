"use client";

import { Bot, Image as ImageIcon, RotateCcw, RotateCw, ScanSearch, Sparkles } from "lucide-react";
import { Canvas, Circle, FabricImage, Path, Rect, Textbox, type FabricObject } from "fabric";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BLOCKWISE_FABRIC_META_KEY,
  FABRIC_JSON_EXTRA_KEYS,
  getCreativeDesignJson,
  saveCreativeDesignJson,
  type CreativeCopyFields,
  type CreativeDesignJson,
  type CreativeDesignObjectJson,
  type CreativeLayerMeta,
} from "@/lib/adstudio/creative-design-json.ts";
import { buildCreativeDesignJson } from "@/lib/adstudio/creative-design-builder.ts";
import { runRenderedTileQA, type RenderedTileQAResult } from "@/lib/adstudio/creative-qa.ts";
import {
  CENTER_FOCAL,
  computeFocalPointFromImageSource,
  focalCoverPlacement,
  type FocalPoint,
  type FrameBox,
} from "@/lib/adstudio/smart-crop.ts";
import { getFabricImageLoadOptions } from "@/lib/adstudio/fabric-image-load.ts";
import type { AdStudioBrandKit, AdStudioCreative } from "@/lib/adstudio/types.ts";
import type { SelectedElement } from "../preview";
import { useCreativeHistory } from "./use-creative-history";

type BlockwiseFabricObject = FabricObject & {
  [BLOCKWISE_FABRIC_META_KEY]?: CreativeLayerMeta;
  text?: string;
  clip?: CreativeDesignObjectJson["clip"];
};

export type FabricAdEditorProps = {
  creative: AdStudioCreative;
  brandKit: AdStudioBrandKit;
  copy: CreativeCopyFields;
  imageSrc: string;
  selectedElement: SelectedElement;
  onSelectedElementChange: (element: SelectedElement) => void;
  onCopyChange: (key: keyof CreativeCopyFields, value: string) => void;
  onImageChange: (src: string) => void;
  onCreativeChange: (creative: AdStudioCreative) => void;
  onRequestImageReplace: () => void;
  onPatchSelectedLayer: () => void | Promise<void>;
};

type MoreOptionsState = {
  loading: boolean;
  error: string | null;
  options: Array<{ image: string; index: number }>;
  complianceIssues: string[];
};

export function FabricAdEditor({
  creative,
  brandKit,
  copy,
  imageSrc,
  selectedElement,
  onSelectedElementChange,
  onCopyChange,
  onImageChange,
  onCreativeChange,
  onRequestImageReplace,
  onPatchSelectedLayer,
}: FabricAdEditorProps) {
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const creativeRef = useRef(creative);
  const copyRef = useRef(copy);
  const imageSrcRef = useRef(imageSrc);
  const historyRef = useRef<ReturnType<typeof useCreativeHistory> | null>(null);
  const callbacksRef = useRef({ onCopyChange, onCreativeChange, onImageChange, onSelectedElementChange });
  const suppressCommitRef = useRef(false);
  const mountedKeyRef = useRef("");
  const creativeKey = `${creative.creativeId}:${creative.format}`;
  // Captured once per creative/format. Live copy + image edits are applied to the
  // mounted canvas via the sync effects below, never by rebuilding the canvas.
  const initialDesign = useMemo(
    () => getCreativeDesignJson(creative) ?? buildCreativeDesignJson({ creative, brandKit, copy, imageSrc }),
    [brandKit, creativeKey],
  );
  const history = useCreativeHistory(initialDesign);

  // Keep the latest props in refs so canvas event handlers and the mount effect
  // stay identity-stable. Without this, parent re-renders (new handler identities)
  // disposed and rebuilt the canvas on every keystroke, reverting all edits.
  useEffect(() => {
    creativeRef.current = creative;
    copyRef.current = copy;
    imageSrcRef.current = imageSrc;
    historyRef.current = history;
    callbacksRef.current = { onCopyChange, onCreativeChange, onImageChange, onSelectedElementChange };
  });

  // Phase 6: QA on the rendered tile, re-run after every manual edit (pure, no
  // model call). Scores the final composited layout + AU copy compliance.
  const [tileQa, setTileQa] = useState<RenderedTileQAResult | null>(null);

  const commitCanvas = useCallback((options: { pushHistory?: boolean } = {}) => {
    const canvas = fabricRef.current;
    if (!canvas || suppressCommitRef.current) return;

    const activeCreative = creativeRef.current;
    const designJson = readCanvasJson(canvas, activeCreative);
    if (options.pushHistory !== false) historyRef.current?.push(designJson);
    const nextCreative = saveCreativeDesignJson(activeCreative, designJson);
    const callbacks = callbacksRef.current;
    callbacks.onCreativeChange(nextCreative);
    syncCopyFromCanvasJson(designJson, (key, value) => callbacks.onCopyChange(key, value));
    syncImageFromCanvasJson(designJson, (src) => callbacks.onImageChange(src));

    const copyText = nextCreative.canvas.objects
      .filter((object) => object.type === "text")
      .map((object) => object.content ?? "")
      .join(" ");
    setTileQa(runRenderedTileQA({ creative: nextCreative, copyText }));
  }, []);

  useEffect(() => {
    const canvasElement = canvasElementRef.current;
    if (!canvasElement) return;

    const key = creativeKey;
    mountedKeyRef.current = key;
    const mountCreative = creativeRef.current;
    const canvas = new Canvas(canvasElement, {
      width: mountCreative.canvas.width,
      height: mountCreative.canvas.height,
      backgroundColor: backgroundFill(mountCreative),
      preserveObjectStacking: true,
      selection: false,
      enableRetinaScaling: true,
    });
    fabricRef.current = canvas;
    suppressCommitRef.current = true;
    applyDisplaySize(canvas, mountCreative);

    let disposed = false;
    const resize = () => applyDisplaySize(canvas, creativeRef.current);
    window.addEventListener("resize", resize);
    const selectElement = (element: SelectedElement) => callbacksRef.current.onSelectedElementChange(element);
    // Click-to-edit: a plain click on a text layer drops the caret in so you can
    // just type. A click that moved more than a few pixels is treated as a drag,
    // so repositioning text still works.
    let pressXY: { x: number; y: number } | null = null;
    const disposers = [
      canvas.on("selection:created", () => syncSelection(canvas, selectElement)),
      canvas.on("selection:updated", () => syncSelection(canvas, selectElement)),
      canvas.on("selection:cleared", () => selectElement("canvas")),
      canvas.on("object:modified", () => commitCanvas()),
      canvas.on("text:changed", () => commitCanvas()),
      canvas.on("text:editing:exited", () => commitCanvas()),
      canvas.on("mouse:down", (opt) => {
        pressXY = pointerFromEvent(opt.e);
      }),
      canvas.on("mouse:up", (opt) => {
        const start = pressXY;
        pressXY = null;
        const target = opt.target as BlockwiseFabricObject | undefined;
        const meta = target ? getMeta(target) : null;
        if (!target || !meta || meta.type !== "text" || meta.locked) return;
        if ((target as Textbox).isEditing) return;
        const end = pointerFromEvent(opt.e);
        if (start && end && Math.hypot(end.x - start.x, end.y - start.y) > 5) return;
        const textbox = target as Textbox;
        textbox.enterEditing();
        const caret = textbox.text?.length ?? 0;
        textbox.selectionStart = caret;
        textbox.selectionEnd = caret;
        canvas.requestRenderAll();
      }),
    ];

    void loadDesign(canvas, initialDesign, brandKit).then(async () => {
      if (disposed || mountedKeyRef.current !== key) return;
      addSafeAreaOverlay(canvas, creativeRef.current);
      // Apply state that changed while the design was loading (e.g. an upload or
      // copy edit in flight), so nothing is swallowed by the suppress window.
      updateTextRole(canvas, "headline", copyRef.current.headline);
      updateTextRole(canvas, "subheadline", copyRef.current.description);
      updateTextRole(canvas, "cta_text", copyRef.current.cta);
      await replaceImageLayerIfNeeded(canvas, imageSrcRef.current, { select: false });
      if (disposed || mountedKeyRef.current !== key) return;
      canvas.requestRenderAll();
      const designJson = readCanvasJson(canvas, creativeRef.current);
      historyRef.current?.reset(designJson);
      suppressCommitRef.current = false;
    });

    return () => {
      disposed = true;
      window.removeEventListener("resize", resize);
      disposers.forEach((dispose) => dispose());
      fabricRef.current = null;
      void canvas.dispose();
    };
  }, [brandKit, commitCanvas, creativeKey, initialDesign]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || suppressCommitRef.current) return;
    updateTextRole(canvas, "headline", copy.headline);
    updateTextRole(canvas, "subheadline", copy.description);
    updateTextRole(canvas, "cta_text", copy.cta);
    canvas.requestRenderAll();
    commitCanvas({ pushHistory: false });
  }, [commitCanvas, copy.cta, copy.description, copy.headline]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || suppressCommitRef.current) return;
    void replaceImageLayerIfNeeded(canvas, imageSrc).then((changed) => {
      if (!changed || fabricRef.current !== canvas) return;
      canvas.requestRenderAll();
      commitCanvas({ pushHistory: false });
    });
  }, [commitCanvas, imageSrc]);

  const applyHistory = useCallback((json: CreativeDesignJson | null) => {
    const canvas = fabricRef.current;
    if (!canvas || !json) return;
    suppressCommitRef.current = true;
    void loadDesign(canvas, json, brandKit).then(() => {
      if (fabricRef.current !== canvas) return;
      addSafeAreaOverlay(canvas, creativeRef.current);
      canvas.requestRenderAll();
      suppressCommitRef.current = false;
      commitCanvas({ pushHistory: false });
    });
  }, [brandKit, commitCanvas]);

  // WS7 "Create more options": opt-in generative alternatives. Fully isolated —
  // a failure here only affects this button, never the canvas/Create flow.
  const [moreOptions, setMoreOptions] = useState<MoreOptionsState>({
    loading: false,
    error: null,
    options: [],
    complianceIssues: [],
  });

  const handleCreateMoreOptions = useCallback(async () => {
    const currentCopy = copyRef.current;
    const photo = imageSrcRef.current;
    const format = creativeRef.current.format;
    setMoreOptions((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const promptSeed = [
        "Alternative finished real estate lead-gen ad creative.",
        currentCopy.headline ? `Headline intent: ${currentCopy.headline}.` : "",
        brandKit.visualStyle.styleTags.length ? `Brand style: ${brandKit.visualStyle.styleTags.join(", ")}.` : "",
        "Keep it premium, on-brand, and faithful to the supplied property photo.",
      ]
        .filter(Boolean)
        .join(" ");
      const response = await fetch("/api/adstudio/generate-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptSeed,
          copyText: [currentCopy.headline, currentCopy.description, currentCopy.cta].filter(Boolean).join(" — "),
          sourceImage: photo || undefined,
          aspectRatio: format,
          brandKitId: brandKit.brandKitId,
          optionCount: 3,
          brand: {
            palette: [brandKit.colours.primary, brandKit.colours.accent].filter(Boolean),
            styleTags: brandKit.visualStyle.styleTags,
            imageTreatment: brandKit.visualStyle.imageTreatment,
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        options?: Array<{ image?: string; index?: number }>;
        compliance?: { pass?: boolean; issues?: Array<{ code?: string }> };
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not create more options.");
      }
      const options = Array.isArray(payload.options)
        ? payload.options
            .filter((option): option is { image: string; index: number } => typeof option?.image === "string")
            .map((option, index) => ({ image: option.image, index: option.index ?? index }))
        : [];
      const complianceIssues =
        payload.compliance && payload.compliance.pass === false
          ? (payload.compliance.issues ?? []).map((issue) => issue.code ?? "").filter(Boolean)
          : [];
      setMoreOptions({ loading: false, error: null, options, complianceIssues });
    } catch (error) {
      setMoreOptions({
        loading: false,
        error: error instanceof Error ? error.message : "Could not create more options.",
        options: [],
        complianceIssues: [],
      });
    }
  }, [brandKit]);

  const applyMoreOption = useCallback(
    (src: string) => {
      if (!src) return;
      try {
        onImageChange(src);
        setMoreOptions({ loading: false, error: null, options: [], complianceIssues: [] });
      } catch (error) {
        // Honour the isolation contract: never let applying an option crash the editor.
        setMoreOptions({
          loading: false,
          error: error instanceof Error ? error.message : "Could not apply that option.",
          options: [],
          complianceIssues: [],
        });
      }
    },
    [onImageChange],
  );

  const dismissMoreOptions = useCallback(() => {
    setMoreOptions({ loading: false, error: null, options: [], complianceIssues: [] });
  }, []);

  const showOptionsPanel =
    moreOptions.options.length > 0 || moreOptions.error !== null || moreOptions.complianceIssues.length > 0;

  return (
    <div className="studio-fabric-editor">
      <div className="studio-fabric-toolbar" aria-label="Creative editor tools">
        <button className="icon" aria-label="Undo" title="Undo" disabled={!history.canUndo} type="button" onClick={() => applyHistory(history.undo())}>
          <RotateCcw aria-hidden size={16} />
        </button>
        <button className="icon" aria-label="Redo" title="Redo" disabled={!history.canRedo} type="button" onClick={() => applyHistory(history.redo())}>
          <RotateCw aria-hidden size={16} />
        </button>
        <span className="studio-fabric-toolbar-divider" aria-hidden />
        <button title="Swap the photo for one from your computer" type="button" onClick={onRequestImageReplace}>
          <ImageIcon aria-hidden size={16} />
          <span>Replace photo</span>
        </button>
        <button
          title="Fill the frame with the selected photo"
          type="button"
          onClick={() => {
            fitSelectedImage(fabricRef.current);
            commitCanvas();
          }}
        >
          <ScanSearch aria-hidden size={16} />
          <span>Fit photo</span>
        </button>
        <button title="Rewrite the selected text" type="button" onClick={() => void onPatchSelectedLayer()}>
          <Bot aria-hidden size={16} />
          <span>Rewrite text</span>
        </button>
        <button
          title="Generate alternative finished creatives from your photo and copy"
          type="button"
          disabled={moreOptions.loading}
          onClick={() => void handleCreateMoreOptions()}
        >
          <Sparkles aria-hidden size={16} />
          <span>{moreOptions.loading ? "Creating…" : "More options"}</span>
        </button>
      </div>
      {tileQa && (
        <div className="studio-fabric-qa" style={{ padding: "4px 12px", fontSize: 12 }} aria-live="polite">
          <span style={{ color: tileQa.pass ? "#15803d" : "#b42318" }}>
            {tileQa.pass
              ? "✓ Tile QA passed"
              : `⚠ Tile QA: ${tileQa.reasons.length} issue${tileQa.reasons.length === 1 ? "" : "s"}`}
          </span>
          {!tileQa.pass && tileQa.reasons.length > 0 && (
            <span style={{ marginLeft: 8, opacity: 0.8 }}>{tileQa.reasons.slice(0, 2).join("; ")}</span>
          )}
        </div>
      )}
      {showOptionsPanel && (
        <div
          className="studio-fabric-options"
          style={{ display: "flex", gap: 8, padding: "8px 12px", flexWrap: "wrap", alignItems: "center" }}
        >
          {moreOptions.error && <span style={{ color: "#b42318", fontSize: 13 }}>{moreOptions.error}</span>}
          {moreOptions.complianceIssues.length > 0 && (
            <span style={{ color: "#b54708", fontSize: 13 }}>
              Compliance check flagged: {moreOptions.complianceIssues.join(", ")}
            </span>
          )}
          {moreOptions.options.map((option) => (
            <button
              key={option.index}
              type="button"
              title="Use this option as the photo"
              onClick={() => applyMoreOption(option.image)}
              style={{ padding: 0, border: "1px solid #d0d5dd", borderRadius: 8, overflow: "hidden", lineHeight: 0, cursor: "pointer" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={option.image}
                alt={`Option ${option.index + 1}`}
                width={72}
                height={72}
                style={{ objectFit: "cover", display: "block" }}
              />
            </button>
          ))}
          {showOptionsPanel && (
            <button type="button" onClick={dismissMoreOptions} title="Dismiss options" style={{ fontSize: 13 }}>
              Dismiss
            </button>
          )}
        </div>
      )}
      <div className="studio-fabric-shell" data-format={creative.format} data-selected={selectedElement}>
        <canvas ref={canvasElementRef} />
      </div>
    </div>
  );
}

async function loadDesign(canvas: Canvas, designJson: CreativeDesignJson, brandKit: AdStudioBrandKit) {
  canvas.clear();
  canvas.backgroundColor = "#FFFFFF";

  for (const object of designJson.objects) {
    const meta = object[BLOCKWISE_FABRIC_META_KEY];
    if (!meta) continue;
    if (meta.type === "image") {
      await addImageObject(canvas, object, meta);
    } else if (meta.type === "text") {
      addTextObject(canvas, object, meta);
    } else if (meta.type === "logo") {
      await addLogoObject(canvas, object, meta, brandKit);
    } else {
      addRectObject(canvas, object, meta);
    }
  }
}

function addTextObject(canvas: Canvas, object: CreativeDesignObjectJson, meta: CreativeLayerMeta) {
  const text = new Textbox(typeof object.text === "string" ? object.text : "", {
    ...interactiveOptions(meta),
    left: numberOr(object.left, 0),
    top: numberOr(object.top, 0),
    width: numberOr(object.width, 320),
    height: numberOr(object.height, undefined),
    originX: "left",
    originY: "top",
    fill: typeof object.fill === "string" ? object.fill : "#131B2E",
    fontFamily: typeof object.fontFamily === "string" ? object.fontFamily : "Inter",
    fontSize: numberOr(object.fontSize, 36),
    fontWeight: typeof object.fontWeight === "number" || typeof object.fontWeight === "string" ? object.fontWeight : 600,
    lineHeight: numberOr(object.lineHeight, 1.18),
  });
  attachMeta(text, meta);
  canvas.add(text);
}

function addRectObject(canvas: Canvas, object: CreativeDesignObjectJson, meta: CreativeLayerMeta) {
  const rect = new Rect({
    ...interactiveOptions(meta),
    left: numberOr(object.left, 0),
    top: numberOr(object.top, 0),
    width: numberOr(object.width, 100),
    height: numberOr(object.height, 100),
    originX: "left",
    originY: "top",
    fill: typeof object.fill === "string" ? object.fill : "#123E75",
    rx: numberOr(object.rx, 0),
    ry: numberOr(object.ry, 0),
    strokeWidth: 0,
  });
  attachMeta(rect, meta);
  canvas.add(rect);
}

async function addImageObject(canvas: Canvas, object: CreativeDesignObjectJson, meta: CreativeLayerMeta) {
  const src = typeof object.src === "string" && object.src ? object.src : "";
  const frame = {
    left: numberOr(object.left, 0),
    top: numberOr(object.top, 0),
    width: numberOr(object.width, 320),
    height: numberOr(object.height, 240),
  };

  if (!src) {
    addImagePlaceholder(canvas, frame, meta);
    return;
  }

  try {
    const image = await loadFabricImage(src);
    image.set({
      ...interactiveOptions(meta),
      left: frame.left,
      top: frame.top,
      originX: "left",
      originY: "top",
      clip: object.clip,
      clipPath: clipPathForFrame(frame, object.clip),
    });
    fitImageToFrame(image, frame, focalForImage(image));
    attachMeta(image, meta);
    canvas.add(image);
  } catch {
    addImagePlaceholder(canvas, frame, meta);
  }
}

function addImagePlaceholder(canvas: Canvas, frame: { left: number; top: number; width: number; height: number }, meta: CreativeLayerMeta) {
  const rect = new Rect({
    ...interactiveOptions(meta),
    left: frame.left,
    top: frame.top,
    width: frame.width,
    height: frame.height,
    originX: "left",
    originY: "top",
    fill: "#D9E7E3",
    rx: 22,
    ry: 22,
    strokeWidth: 0,
  });
  attachMeta(rect, meta);
  canvas.add(rect);
}

async function addLogoObject(canvas: Canvas, object: CreativeDesignObjectJson, meta: CreativeLayerMeta, brandKit: AdStudioBrandKit) {
  const frame = {
    left: numberOr(object.left, 0),
    top: numberOr(object.top, 0),
    width: numberOr(object.width, 180),
    height: numberOr(object.height, 64),
  };
  const src = typeof object.src === "string" && object.src ? object.src : brandKit.logos.primaryLogoUrl ?? "";

  if (src) {
    try {
      const image = await loadFabricImage(src);
      image.set({
        ...interactiveOptions(meta),
        left: frame.left,
        top: frame.top,
        originX: "left",
        originY: "top",
        clipPath: clipPathForFrame(frame),
      });
      fitImageContainToFrame(image, frame.width, frame.height);
      attachMeta(image, meta);
      canvas.add(image);
      return;
    } catch {
      // Fall through to text mark when the stored logo cannot be loaded.
    }
  }

  addRectObject(canvas, object, meta);
  const label = new Textbox(brandLabel(object, brandKit), {
    left: frame.left + 16,
    top: frame.top + Math.max(8, frame.height * 0.24),
    width: Math.max(80, frame.width - 28),
    originX: "left",
    originY: "top",
    fill: "#FFFFFF",
    fontFamily: "Inter",
    fontSize: Math.max(16, Math.round(frame.height * 0.28)),
    fontWeight: 800,
    selectable: false,
    evented: false,
  });
  canvas.add(label);
}

function brandLabel(object: CreativeDesignObjectJson, brandKit: AdStudioBrandKit): string {
  if (typeof object.text === "string" && object.text.trim()) return object.text.trim();
  return brandKit.identity.tradingName || brandKit.identity.businessName || "Brand";
}

function addSafeAreaOverlay(canvas: Canvas, creative: AdStudioCreative) {
  if (!creative.safeZones.metaStory) return;
  const top = new Rect({
    left: 0,
    top: 0,
    width: creative.canvas.width,
    height: 250,
    originX: "left",
    originY: "top",
    fill: "rgba(255,255,255,0.08)",
    stroke: "rgba(255,255,255,0.5)",
    strokeDashArray: [18, 14],
    selectable: false,
    evented: false,
    excludeFromExport: true,
  });
  const bottom = new Rect({
    left: 0,
    top: creative.canvas.height - 340,
    width: creative.canvas.width,
    height: 340,
    originX: "left",
    originY: "top",
    fill: "rgba(255,255,255,0.08)",
    stroke: "rgba(255,255,255,0.5)",
    strokeDashArray: [18, 14],
    selectable: false,
    evented: false,
    excludeFromExport: true,
  });
  canvas.add(top, bottom);
}

function normalizeSrc(value: string): string {
  if (!value) return value;
  try {
    return new URL(value, window.location.href).href;
  } catch {
    return value;
  }
}

/** Replaces the primary image only when the canvas shows a different source. */
async function replaceImageLayerIfNeeded(
  canvas: Canvas,
  src: string,
  options: { select?: boolean } = {},
): Promise<boolean> {
  if (!src) return false;
  const current = canvas.getObjects().find((object) => getMeta(object)?.role === "primary_image");
  if (!current) return false;
  if (current instanceof FabricImage && normalizeSrc(current.getSrc()) === normalizeSrc(src)) return false;
  await replaceImageLayer(canvas, src, options);
  return true;
}

async function replaceImageLayer(canvas: Canvas, src: string, options: { select?: boolean } = {}) {
  const current = canvas.getObjects().find((object) => getMeta(object)?.role === "primary_image");
  const meta = current ? getMeta(current) : null;
  if (!current || !meta) return;
  const currentImage = current as BlockwiseFabricObject;
  const frame = {
    left: numberOr(currentImage.left, 0),
    top: numberOr(currentImage.top, 0),
    width: Math.round(numberOr(currentImage.width, 320) * numberOr(currentImage.scaleX, 1)),
    height: Math.round(numberOr(currentImage.height, 240) * numberOr(currentImage.scaleY, 1)),
  };
  canvas.remove(current);

  try {
    const image = await loadFabricImage(src);
    image.set({
      ...interactiveOptions(meta),
      left: frame.left,
      top: frame.top,
      originX: "left",
      originY: "top",
      clip: currentImage.clip,
      clipPath: clipPathForFrame(frame, currentImage.clip),
    });
    fitImageToFrame(image, frame, focalForImage(image));
    attachMeta(image, meta);
    canvas.add(image);
    if (options.select !== false) canvas.setActiveObject(image);
  } catch {
    addImagePlaceholder(canvas, frame, meta);
  }
}

function loadFabricImage(src: string) {
  const loadOptions = getFabricImageLoadOptions(src);
  return loadOptions ? FabricImage.fromURL(src, loadOptions) : FabricImage.fromURL(src);
}

function fitSelectedImage(canvas: Canvas | null) {
  if (!canvas) return;
  const object = canvas.getActiveObject() as BlockwiseFabricObject | undefined;
  const meta = object ? getMeta(object) : null;
  if (!object || meta?.editableKind !== "image") return;
  const frame = frameFromObject(object);
  const focal = object instanceof FabricImage ? focalForImage(object) : CENTER_FOCAL;
  fitImageToFrame(object, frame, focal);
  canvas.requestRenderAll();
}

// Cover-fit the image into the frame, then offset it so the busiest part of
// the photo (the focal point) lands at the frame centre instead of pinning a
// corner and clipping the subject away.
function fitImageToFrame(object: BlockwiseFabricObject, frame: FrameBox, focal: FocalPoint = CENTER_FOCAL) {
  const sourceWidth = numberOr(object.width, frame.width);
  const sourceHeight = numberOr(object.height, frame.height);
  const placement = focalCoverPlacement({ frame, sourceWidth, sourceHeight, focal });
  object.set({
    scaleX: placement.scale,
    scaleY: placement.scale,
    left: placement.left,
    top: placement.top,
  });
}

// Best-effort saliency focal point for a Fabric image; centre on any failure.
function focalForImage(image: FabricImage): FocalPoint {
  try {
    const element = image.getElement() as CanvasImageSource | undefined;
    if (!element) return CENTER_FOCAL;
    return computeFocalPointFromImageSource(
      element,
      numberOr(image.width, 0),
      numberOr(image.height, 0),
    );
  } catch {
    return CENTER_FOCAL;
  }
}

// The clip rect is absolutely positioned, so it carries the true frame box in
// canvas coordinates - the reliable source when re-fitting an existing image.
function frameFromObject(object: BlockwiseFabricObject): FrameBox {
  const clip = (object as { clipPath?: FabricObject }).clipPath;
  if (clip) {
    const width = numberOr(clip.width, 0) * numberOr(clip.scaleX, 1);
    const height = numberOr(clip.height, 0) * numberOr(clip.scaleY, 1);
    if (width > 0 && height > 0) {
      return { left: numberOr(clip.left, 0), top: numberOr(clip.top, 0), width, height };
    }
  }
  return {
    left: numberOr(object.left, 0),
    top: numberOr(object.top, 0),
    width: Math.round(numberOr(object.width, 320) * numberOr(object.scaleX, 1)),
    height: Math.round(numberOr(object.height, 240) * numberOr(object.scaleY, 1)),
  };
}

function fitImageContainToFrame(object: BlockwiseFabricObject, frameWidth: number, frameHeight: number) {
  const sourceWidth = numberOr(object.width, frameWidth);
  const sourceHeight = numberOr(object.height, frameHeight);
  const scale = Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight);
  object.set({
    scaleX: scale,
    scaleY: scale,
  });
}

function clipPathForFrame(
  frame: { left: number; top: number; width: number; height: number },
  clip: CreativeDesignObjectJson["clip"] = "rect",
) {
  if (clip === "circle") {
    return new Circle({
      left: frame.left,
      top: frame.top,
      radius: Math.min(frame.width, frame.height) / 2,
      originX: "left",
      originY: "top",
      absolutePositioned: true,
    });
  }

  if (clip === "arch") {
    const r = frame.width / 2;
    return new Path(
      `M ${frame.left} ${frame.top + frame.height} V ${frame.top + r} A ${r} ${r} 0 0 1 ${frame.left + frame.width} ${frame.top + r} V ${frame.top + frame.height} Z`,
      {
        originX: "left",
        originY: "top",
        absolutePositioned: true,
      },
    );
  }

  return new Rect({
    left: frame.left,
    top: frame.top,
    width: frame.width,
    height: frame.height,
    originX: "left",
    originY: "top",
    absolutePositioned: true,
  });
}

function readCanvasJson(canvas: Canvas, creative: AdStudioCreative): CreativeDesignJson {
  const json = (canvas.toJSON as (propertiesToInclude?: string[]) => unknown)([
    ...FABRIC_JSON_EXTRA_KEYS,
  ]) as Record<string, unknown>;
  const objects = Array.isArray(json.objects)
    ? (json.objects as CreativeDesignObjectJson[]).filter((object) => object[BLOCKWISE_FABRIC_META_KEY])
    : [];
  return {
    ...json,
    version: "blockwise-fabric-v1",
    width: creative.canvas.width,
    height: creative.canvas.height,
    objects,
  };
}

function syncCopyFromCanvasJson(designJson: CreativeDesignJson, onCopyChange: FabricAdEditorProps["onCopyChange"]) {
  for (const object of designJson.objects) {
    const meta = object[BLOCKWISE_FABRIC_META_KEY];
    if (!meta || typeof object.text !== "string") continue;
    if (meta.role === "headline") onCopyChange("headline", object.text);
    if (meta.role === "subheadline") onCopyChange("description", object.text);
    if (meta.role === "cta_text") onCopyChange("cta", object.text);
  }
}

function syncImageFromCanvasJson(designJson: CreativeDesignJson, onImageChange: (src: string) => void) {
  const image = designJson.objects.find((object) => object[BLOCKWISE_FABRIC_META_KEY]?.role === "primary_image");
  if (typeof image?.src === "string" && image.src) onImageChange(image.src);
}

function updateTextRole(canvas: Canvas, role: string, text: string) {
  const object = canvas.getObjects().find((candidate) => getMeta(candidate)?.role === role) as BlockwiseFabricObject | undefined;
  if (object && typeof object.set === "function" && object.text !== text) {
    object.set("text", text);
  }
}

function syncSelection(canvas: Canvas, onSelectedElementChange: FabricAdEditorProps["onSelectedElementChange"]) {
  const active = canvas.getActiveObject();
  const meta = active ? getMeta(active) : null;
  if (!meta) return;
  if (meta.editableKind === "headline") onSelectedElementChange("headline");
  if (meta.editableKind === "description") onSelectedElementChange("description");
  if (meta.editableKind === "cta") onSelectedElementChange("cta");
  if (meta.editableKind === "image") onSelectedElementChange("image");
}

function attachMeta(object: FabricObject, meta: CreativeLayerMeta) {
  (object as BlockwiseFabricObject)[BLOCKWISE_FABRIC_META_KEY] = meta;
}

function getMeta(object: FabricObject): CreativeLayerMeta | null {
  return (object as BlockwiseFabricObject)[BLOCKWISE_FABRIC_META_KEY] ?? null;
}

/** Screen-space pointer from the raw DOM event, so click-vs-drag detection
 *  works the same across Fabric versions without relying on internal point APIs. */
function pointerFromEvent(event: unknown): { x: number; y: number } | null {
  const mouse = event as { clientX?: number; clientY?: number } | undefined;
  if (mouse && typeof mouse.clientX === "number" && typeof mouse.clientY === "number") {
    return { x: mouse.clientX, y: mouse.clientY };
  }
  const touch = (event as { touches?: ArrayLike<{ clientX: number; clientY: number }> } | undefined)?.touches?.[0];
  if (touch) return { x: touch.clientX, y: touch.clientY };
  return null;
}

function interactiveOptions(meta: CreativeLayerMeta) {
  const unlocked = !meta.locked;
  return {
    selectable: unlocked,
    evented: unlocked,
    hasControls: unlocked,
    lockMovementX: meta.locked,
    lockMovementY: meta.locked,
    lockScalingX: meta.locked,
    lockScalingY: meta.locked,
    lockRotation: meta.locked,
    editable: unlocked && meta.type === "text",
    // Wordless affordance: hovering text shows a caret, the image shows a pointer,
    // so users can see what they can click into before they click.
    hoverCursor: unlocked ? (meta.type === "text" ? "text" : meta.type === "image" ? "pointer" : "move") : "default",
  };
}

function backgroundFill(creative: AdStudioCreative) {
  return creative.canvas.objects.find((object) => object.role === "background_shape")?.fill ?? "#F1F5F9";
}

function applyDisplaySize(canvas: Canvas, creative: AdStudioCreative) {
  const maxWidthByFormat: Record<string, number> = {
    "9:16": 350,
    "4:5": 475,
    "1:1": 520,
    "1.91:1": 560,
  };
  const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
  const maxWidth = maxWidthByFormat[creative.format] ?? 520;
  const parentWidth = canvas.getElement().parentElement?.clientWidth ?? maxWidth;
  const availableWidth = parentWidth > 0 ? Math.min(maxWidth, parentWidth) : maxWidth;
  const maxHeight = Math.max(360, viewportHeight - 250);
  const scale = Math.min(availableWidth / creative.canvas.width, maxHeight / creative.canvas.height, 1);
  canvas.setDimensions(
    {
      width: `${Math.round(creative.canvas.width * scale)}px`,
      height: `${Math.round(creative.canvas.height * scale)}px`,
    },
    { cssOnly: true },
  );
}

// Coerce a possibly-undefined Fabric numeric prop to a finite number.
function numberOr(value: unknown, fallback: number): number;
function numberOr(value: unknown, fallback: undefined): undefined;
function numberOr(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
