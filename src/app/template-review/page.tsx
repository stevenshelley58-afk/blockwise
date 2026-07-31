"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Search, Plus, Save, Trash2, X } from "lucide-react";

/* ── Types ─────────────────────────────────────────────────────────── */

interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TypographyEntry {
  fontId: string;
  family: string;
  fallbackFamily?: string;
  weight: number;
  italic: boolean;
  case: string;
  sizeRatio: number;
  lineHeight: number;
  tracking: number;
  align: string;
  color: string;
  fitScore: number;
  detectionScore: number;
  sampleBox: TextBox;
  sampleLineCount: number;
  fontFile: string;
  measuredLines?: unknown[];
  measurementVersion?: number;
  measurementSource?: string;
}

interface TextInputDef {
  key: string;
  label: string;
  maxLength: number;
  sample: string;
  required: boolean;
}

interface TemplateSample {
  imageSrc: string;
  thumbnailSrc?: string;
  alt?: string;
}

interface Template {
  id: string;
  name: string;
  format: string;
  dimensions?: { width: number; height: number };
  sample: TemplateSample;
  inputs: { text: TextInputDef[]; images?: unknown[] };
  typography: Record<string, TypographyEntry>;
  status?: string;
  goal?: string;
}

interface FontManifestFace {
  file: string;
  fontId: string;
  family: string;
  weight: number;
  italic: boolean;
}

interface FontManifest {
  gates: { minFontFit: number; minRegionConfidence: number };
  faces: FontManifestFace[];
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function regionColor(typo: TypographyEntry | undefined, gates: { minFontFit: number }): "green" | "yellow" | "red" {
  if (!typo || !typo.fontFile) return "red";
  if (typo.fitScore >= gates.minFontFit) return "green";
  return "yellow";
}

const colorClasses = {
  green: "border-emerald-400 bg-emerald-400/20 text-emerald-300",
  yellow: "border-amber-400 bg-amber-400/20 text-amber-300",
  red: "border-red-400 bg-red-400/20 text-red-300",
} as const;

const colorBorder = {
  green: "border-emerald-400",
  yellow: "border-amber-400",
  red: "border-red-400",
} as const;

/* ── Component ─────────────────────────────────────────────────────── */

export default function TemplateReviewPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [manifest, setManifest] = useState<FontManifest | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  // Editable working copy of the selected template
  const [draft, setDraft] = useState<Template | null>(null);

  // Canvas refs
  const canvasRef = useRef<HTMLDivElement>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });

  // Add-region form state
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newSample, setNewSample] = useState("");
  const [newMaxLen, setNewMaxLen] = useState(30);
  const [newRequired, setNewRequired] = useState(false);
  const [newBox, setNewBox] = useState<TextBox>({ x: 0.1, y: 0.1, width: 0.3, height: 0.1 });
  const [newFontId, setNewFontId] = useState("manrope");
  const [newWeight, setNewWeight] = useState(600);
  const [newSizeRatio, setNewSizeRatio] = useState(0.8);

  /* ── Fetch data ────────────────────────────────────────────────── */

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/template-review");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTemplates(data.templates ?? data);
      if (data.manifest) setManifest(data.manifest);
    } catch (err) {
      toast.error("Failed to fetch templates");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
    // Also try loading manifest directly as fallback
    fetch("/fonts/adstudio/manifest.json")
      .then((r) => r.json())
      .then((m: FontManifest) => { if (!manifest) setManifest(m); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Select template — fetch full data from the detail API
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setFetchError(null);
    (async () => {
      try {
        const res = await fetch(`/api/dev/template-review/${selectedId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const full: Template = await res.json();
        if (cancelled) return;
        // Ensure required shapes exist even if the API returns partial data
        const safe: Template = {
          ...full,
          inputs: {
            text: Array.isArray(full.inputs?.text) ? full.inputs.text : [],
            images: full.inputs?.images ?? [],
          },
          typography: (full.typography && typeof full.typography === "object") ? full.typography : {},
          sample: full.sample ?? { imageSrc: "" },
        };
        setDraft(safe);
        // Reset image error state for new template
        setImgError(false);
      } catch (err) {
        if (cancelled) return;
        console.error("[template-review] Failed to fetch template detail:", err);
        setFetchError(`Failed to load template: ${err instanceof Error ? err.message : String(err)}`);
        // Fall back to list data so the page doesn't stay blank
        const fallback = templates.find((t) => t.id === selectedId);
        if (fallback) {
          setDraft({
            ...fallback,
            inputs: { text: [], images: [] },
            typography: {},
            sample: fallback.sample ?? { imageSrc: "" },
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, templates]);

  /* ── Derived ───────────────────────────────────────────────────── */

  const gates = useMemo(() => manifest?.gates ?? { minFontFit: 0.6, minRegionConfidence: 0.6 }, [manifest]);

  const filteredTemplates = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.format?.toLowerCase().includes(q)
    );
  }, [templates, search]);

  const fontFamilies = useMemo(() => {
    if (!manifest) return new Map<string, FontManifestFace[]>();
    const seen = new Map<string, FontManifestFace[]>();
    for (const f of manifest.faces) {
      if (!seen.has(f.family)) seen.set(f.family, []);
      seen.get(f.family)!.push(f);
    }
    return seen;
  }, [manifest]);

  const selectedTypography = draft && selectedKey ? (draft.typography ?? {})[selectedKey] : undefined;
  const selectedTextInput = draft?.inputs?.text?.find((t) => t.key === selectedKey);

  /* ── Image sizing ──────────────────────────────────────────────── */

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImgSize({ w: img.clientWidth, h: img.clientHeight });
  };

  /* ── Save ──────────────────────────────────────────────────────── */

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const body = {
        typography: draft.typography ?? {},
        textInputs: draft.inputs?.text ?? [],
      };
      const res = await fetch(`/api/dev/template-review/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Saved successfully");
      await fetchTemplates();
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  /* ── Update helpers ────────────────────────────────────────────── */

  const updateTypo = (key: string, patch: Partial<TypographyEntry>) => {
    if (!draft) return;
    const existing = (draft.typography ?? {})[key];
    if (!existing) return;
    setDraft({
      ...draft,
      typography: {
        ...draft.typography,
        [key]: { ...existing, ...patch },
      },
    });
  };

  const updateSampleBox = (key: string, box: Partial<TextBox>) => {
    if (!draft) return;
    const cur = draft.typography[key]?.sampleBox ?? { x: 0, y: 0, width: 0.1, height: 0.05 };
    updateTypo(key, { sampleBox: { ...cur, ...box } });
  };

  const deleteRegion = (key: string) => {
    if (!draft) return;
    const { [key]: _, ...rest } = (draft.typography ?? {});
    setDraft({
      ...draft,
      typography: rest,
      inputs: {
        ...draft.inputs,
        text: (draft.inputs?.text ?? []).filter((t) => t.key !== key),
      },
    });
    setSelectedKey(null);
  };

  /* ── Add region ────────────────────────────────────────────────── */

  const handleAddRegion = () => {
    if (!draft || !newKey) return;
    const face = manifest?.faces.find((f) => f.fontId === newFontId);
    const newTypo: TypographyEntry = {
      fontId: newFontId,
      family: face?.family ?? newFontId,
      fallbackFamily: "sans-serif",
      weight: newWeight,
      italic: false,
      case: "mixed",
      sizeRatio: newSizeRatio,
      lineHeight: 1.2,
      tracking: 0,
      align: "left",
      color: "#000000",
      fitScore: 0,
      detectionScore: 0,
      sampleBox: { ...newBox },
      sampleLineCount: 1,
      fontFile: face?.file ?? "",
    };
    const newInput: TextInputDef = {
      key: newKey,
      label: newLabel || newKey,
      maxLength: newMaxLen,
      sample: newSample,
      required: newRequired,
    };
    setDraft({
      ...draft,
      typography: { ...(draft.typography ?? {}), [newKey]: newTypo },
      inputs: {
        ...draft.inputs,
        text: [...(draft.inputs?.text ?? []), newInput],
      },
    });
    setSelectedKey(newKey);
    setAddDialogOpen(false);
    setNewKey("");
    setNewLabel("");
    setNewSample("");
    setNewMaxLen(30);
    setNewRequired(false);
    setNewBox({ x: 0.1, y: 0.1, width: 0.3, height: 0.1 });
  };

  /* ── Drag-to-select on canvas ──────────────────────────────────── */

  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState({ x: 0, y: 0 });
  const [drawCurrent, setDrawCurrent] = useState({ x: 0, y: 0 });

  const normCoords = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !imgSize.w || !imgSize.h) return { nx: 0, ny: 0 };
    return {
      nx: Math.max(0, Math.min(1, (e.clientX - rect.left) / imgSize.w)),
      ny: Math.max(0, Math.min(1, (e.clientY - rect.top) / imgSize.h)),
    };
  };

  /* ── Render ────────────────────────────────────────────────────── */

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Toaster richColors position="top-center" />

      {/* ─── Left Sidebar ─────────────────────────────────────────── */}
      <div className="flex w-[300px] shrink-0 flex-col border-r">
        <div className="border-b p-3">
          <h1 className="mb-2 text-sm font-bold tracking-tight">Template Typography Review</h1>
          <div className="relative">
            <Search className="absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              className="h-8 pl-8 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="p-4 text-center text-xs text-muted-foreground">Loading...</p>
          ) : filteredTemplates.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">No templates found</p>
          ) : (
            filteredTemplates.map((t) => {
              const typoKeys = Object.keys(t.typography ?? {});
              const textCount = t.inputs?.text?.length ?? 0;
              const withFontFile = typoKeys.filter((k) => t.typography[k]?.fontFile).length;
              const allPass = typoKeys.every(
                (k) => t.typography[k]?.fontFile && t.typography[k].fitScore >= gates.minFontFit
              );
              const someHaveFont = withFontFile > 0;
              const statusColor = !someHaveFont ? "red" : allPass ? "green" : "yellow";

              return (
                <button
                  key={t.id}
                  onClick={() => { setSelectedId(t.id); setSelectedKey(null); }}
                  className={`mb-1 w-full rounded-md border p-2 text-left transition-colors hover:bg-accent ${
                    selectedId === t.id ? "border-primary bg-accent" : "border-transparent"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-medium">{t.id}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
                      {t.format}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{t.name}</p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className={colorBorder[statusColor]}>
                      {withFontFile}/{textCount} fonts
                    </span>
                    <span
                      className={`inline-block size-2 rounded-full ${
                        statusColor === "green" ? "bg-emerald-400" : statusColor === "yellow" ? "bg-amber-400" : "bg-red-400"
                      }`}
                    />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ─── Center Canvas ────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {draft ? (
          <>
            <div className="flex items-center justify-between border-b px-4 py-2">
              <div>
                <h2 className="text-sm font-semibold">{draft.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {draft.dimensions?.width ?? 1080}×{draft.dimensions?.height ?? 1350} · {draft.format}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{Object.keys(draft.typography ?? {}).length} regions</span>
              </div>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto p-4">
              <div
                ref={canvasRef}
                className="relative"
                style={{ maxWidth: "100%", maxHeight: "100%" }}
                onMouseDown={(e) => {
                  if (e.target === canvasRef.current || (e.target as HTMLElement).tagName === "IMG") {
                    const { nx, ny } = normCoords(e);
                    setDrawing(true);
                    setDrawStart({ x: nx, y: ny });
                    setDrawCurrent({ x: nx, y: ny });
                  }
                }}
                onMouseMove={(e) => {
                  if (drawing) {
                    const { nx, ny } = normCoords(e);
                    setDrawCurrent({ x: nx, y: ny });
                  }
                }}
                onMouseUp={() => {
                  if (drawing) {
                    setDrawing(false);
                    const x = Math.min(drawStart.x, drawCurrent.x);
                    const y = Math.min(drawStart.y, drawCurrent.y);
                    const w = Math.abs(drawCurrent.x - drawStart.x);
                    const h = Math.abs(drawCurrent.y - drawStart.y);
                    if (w > 0.01 && h > 0.01) {
                      setNewBox({ x, y, width: w, height: h });
                    }
                  }
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={draft.sample?.imageSrc || ""}
                  alt={draft.sample?.alt ?? "Template sample"}
                  onLoad={handleImgLoad}
                  onError={() => setImgError(true)}
                  className="max-h-[calc(100vh-120px)] max-w-full object-contain"
                  draggable={false}
                  style={{ display: "block" }}
                />
                {imgError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted/50 text-xs text-muted-foreground">
                    Failed to load sample image
                  </div>
                )}
                {/* Region overlays */}
                {(Object.entries(draft.typography ?? {}) as [string, TypographyEntry | undefined][]).map(([key, typo]) => {
                  if (!typo?.sampleBox) return null;
                  const box = typo.sampleBox;
                  // Validate coordinates are finite numbers
                  if (!isFinite(box.x) || !isFinite(box.y) || !isFinite(box.width) || !isFinite(box.height)) return null;
                  const c = regionColor(typo, gates);
                  const isSelected = selectedKey === key;
                  return (
                    <button
                      key={key}
                      onClick={(e) => { e.stopPropagation(); setSelectedKey(key); }}
                      className={`absolute cursor-pointer border-2 transition-all ${colorClasses[c]} ${
                        isSelected ? "ring-2 ring-white" : "hover:brightness-125"
                      }`}
                      style={{
                        left: `${box.x * 100}%`,
                        top: `${box.y * 100}%`,
                        width: `${box.width * 100}%`,
                        height: `${box.height * 100}%`,
                      }}
                      title={`${key} (fit: ${typo.fitScore?.toFixed(2)})`}
                    >
                      <span className="absolute -top-4 left-0 text-[9px] font-bold leading-none drop-shadow-md">
                        {key}
                      </span>
                    </button>
                  );
                })}
                {/* Drawing rectangle */}
                {drawing && (
                  <div
                    className="pointer-events-none absolute border-2 border-dashed border-cyan-400 bg-cyan-400/10"
                    style={{
                      left: `${Math.min(drawStart.x, drawCurrent.x) * 100}%`,
                      top: `${Math.min(drawStart.y, drawCurrent.y) * 100}%`,
                      width: `${Math.abs(drawCurrent.x - drawStart.x) * 100}%`,
                      height: `${Math.abs(drawCurrent.y - drawStart.y) * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <p className="text-sm">Select a template to begin</p>
          </div>
        )}
      </div>

      {/* ─── Right Sidebar ────────────────────────────────────────── */}
      <div className="flex w-[350px] shrink-0 flex-col border-l">
        {draft ? (
          <>
            {/* Save bar */}
            <div className="flex items-center justify-between border-b p-3">
              <span className="text-xs font-medium text-muted-foreground">
                {selectedKey ? `Editing: ${selectedKey}` : "No region selected"}
              </span>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save className="size-3.5" />
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {/* Region list */}
              <div className="mb-4">
                <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Regions
                </h3>
                <div className="space-y-1">
                  {(draft.inputs?.text ?? []).map((ti) => {
                    const typo = (draft.typography ?? {})[ti.key];
                    const c = regionColor(typo, gates);
                    return (
                      <button
                        key={ti.key}
                        onClick={() => setSelectedKey(ti.key)}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent ${
                          selectedKey === ti.key ? "bg-accent ring-1 ring-primary" : ""
                        }`}
                      >
                        <span className={`size-2 shrink-0 rounded-full ${colorBorder[c]}`}
                          style={{ backgroundColor: c === "green" ? "#34d399" : c === "yellow" ? "#fbbf24" : "#f87171" }}
                        />
                        <span className="truncate font-medium">{ti.key}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {typo?.family ?? "—"} {typo?.weight ?? ""}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Add region */}
                <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="mt-2 w-full" disabled={!draft}>
                      <Plus className="size-3.5" />
                      Add Text Region
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Add New Text Region</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Key</Label>
                          <Input className="h-8 text-xs" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="e.g. cta_text" />
                        </div>
                        <div>
                          <Label className="text-xs">Label</Label>
                          <Input className="h-8 text-xs" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="CTA Text" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Sample Text</Label>
                          <Input className="h-8 text-xs" value={newSample} onChange={(e) => setNewSample(e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs">Max Length</Label>
                          <Input className="h-8 text-xs" type="number" value={newMaxLen} onChange={(e) => setNewMaxLen(Number(e.target.value))} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox id="new-req" checked={newRequired} onCheckedChange={(v) => setNewRequired(!!v)} />
                        <Label htmlFor="new-req" className="text-xs">Required</Label>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {(["x", "y", "width", "height"] as const).map((prop) => (
                          <div key={prop}>
                            <Label className="text-xs capitalize">Box {prop}</Label>
                            <Input
                              className="h-8 text-xs"
                              type="number"
                              step={0.001}
                              min={0}
                              max={1}
                              value={newBox[prop]}
                              onChange={(e) => setNewBox({ ...newBox, [prop]: Number(e.target.value) })}
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Tip: You can also click-drag on the canvas to draw the box, then open this dialog.
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-xs">Font</Label>
                          <Select value={newFontId} onValueChange={setNewFontId}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from(fontFamilies.keys()).map((fam) => {
                                const face = fontFamilies.get(fam)![0];
                                return (
                                  <SelectItem key={face.fontId} value={face.fontId}>
                                    {fam}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Weight</Label>
                          <Input className="h-8 text-xs" type="number" value={newWeight} onChange={(e) => setNewWeight(Number(e.target.value))} />
                        </div>
                        <div>
                          <Label className="text-xs">Size Ratio</Label>
                          <Input className="h-8 text-xs" type="number" step={0.01} min={0.1} max={2} value={newSizeRatio} onChange={(e) => setNewSizeRatio(Number(e.target.value))} />
                        </div>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={handleAddRegion} disabled={!newKey}>
                        <Plus className="size-3.5" />
                        Add
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              {fetchError && (
                <div className="mb-3 rounded border border-red-400/30 bg-red-400/10 p-2 text-[11px] text-red-300">
                  {fetchError}
                </div>
              )}

              {/* Region editor */}
              {selectedTypography && selectedTextInput ? (
                <RegionEditor
                  key={selectedKey}
                  inputDef={selectedTextInput}
                  typo={selectedTypography}
                  fontFamilies={fontFamilies}
                  gates={gates}
                  onUpdate={(patch) => updateTypo(selectedKey!, patch)}
                  onUpdateBox={(box) => updateSampleBox(selectedKey!, box)}
                  onDelete={() => deleteRegion(selectedKey!)}
                />
              ) : (
                <p className="text-center text-xs text-muted-foreground py-8">
                  Select a region to edit its typography properties
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            No template selected
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Region Editor Sub-component ───────────────────────────────────── */

interface RegionEditorProps {
  inputDef: TextInputDef;
  typo: TypographyEntry;
  fontFamilies: Map<string, FontManifestFace[]>;
  gates: { minFontFit: number; minRegionConfidence: number };
  onUpdate: (patch: Partial<TypographyEntry>) => void;
  onUpdateBox: (box: Partial<TextBox>) => void;
  onDelete: () => void;
}

function RegionEditor({ inputDef, typo, fontFamilies, gates, onUpdate, onUpdateBox, onDelete }: RegionEditorProps) {
  const previewRef = useRef<HTMLCanvasElement>(null);

  // Load font for preview
  useEffect(() => {
    if (!typo.fontFile || !typo.family) return;
    try {
      const fontFaceObj = new FontFace(typo.family, `url(${typo.fontFile})`);
      fontFaceObj.load().then((f) => {
        document.fonts.add(f);
        drawPreview();
      }).catch((err) => {
        console.warn("[template-review] Font load failed:", typo.fontFile, err);
      });
    } catch (err) {
      console.warn("[template-review] FontFace creation failed:", typo.fontFile, err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typo.fontFile, typo.family]);

  // Draw preview
  useEffect(() => {
    drawPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typo]);

  function drawPreview() {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, w, h);

    const sizeRatio = isFinite(typo.sizeRatio) ? typo.sizeRatio : 0.8;
    const fontSize = Math.round(sizeRatio * 20);
    if (fontSize <= 0) return;
    const style = typo.italic ? "italic" : "normal";
    const weight = isFinite(typo.weight) ? typo.weight : 400;
    const family = typo.family || "sans-serif";
    const fallback = typo.fallbackFamily || "sans-serif";
    ctx.font = `${style} ${weight} ${fontSize}px "${family}", ${fallback}`;
    ctx.fillStyle = typo.color || "#ffffff";
    ctx.textBaseline = "top";

    let text = inputDef.sample || inputDef.key;
    if (typo.case === "upper") text = text.toUpperCase();
    else if (typo.case === "lower") text = text.toLowerCase();

    const lh = isFinite(typo.lineHeight) ? typo.lineHeight : 1.2;
    const lineHeight = fontSize * lh;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      ctx.fillText(line, 8, 8 + i * lineHeight);
    });
  }

  const weightOptions = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  const caseOptions = ["none", "upper", "lower", "mixed"];
  const alignOptions = ["left", "center", "right"];

  return (
    <div className="space-y-4">
      {/* Text input info */}
      <Card className="py-3">
        <CardHeader className="px-3 py-0">
          <CardTitle className="text-xs">Text Input</CardTitle>
        </CardHeader>
        <CardContent className="px-3 py-2 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Key</span>
            <span className="font-mono">{inputDef.key}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Label</span>
            <span>{inputDef.label}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Sample</span>
            <span className="max-w-[180px] truncate">{inputDef.sample}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Max Length</span>
            <span>{inputDef.maxLength}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Required</span>
            <span>{inputDef.required ? "Yes" : "No"}</span>
          </div>
        </CardContent>
      </Card>

      {/* Font preview */}
      <div>
        <Label className="mb-1 text-xs text-muted-foreground">Font Preview</Label>
        <canvas
          ref={previewRef}
          className="h-20 w-full rounded border border-border"
          style={{ width: "100%" }}
        />
      </div>

      {/* Typography properties */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Typography
        </h4>

        {/* Font family */}
        <div>
          <Label className="text-xs">Font Family</Label>
          <Select
            value={typo.fontId}
            onValueChange={(v) => {
              const faces = fontFamilies.get(
                Array.from(fontFamilies.entries()).find(([, arr]) => arr[0].fontId === v)?.[0] ?? ""
              );
              const face = faces?.[0];
              onUpdate({
                fontId: v,
                family: face?.family ?? v,
                fontFile: face?.file ?? typo.fontFile,
              });
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from(fontFamilies.entries()).map(([fam, faces]) => (
                <SelectItem key={faces[0].fontId} value={faces[0].fontId}>
                  {fam}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Weight + Italic */}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div>
            <Label className="text-xs">Weight</Label>
            <Select value={String(typo.weight)} onValueChange={(v) => onUpdate({ weight: Number(v) })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {weightOptions.map((w) => (
                  <SelectItem key={w} value={String(w)}>
                    {w}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end pb-1">
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="italic-check"
                checked={typo.italic}
                onCheckedChange={(v) => onUpdate({ italic: !!v })}
              />
              <Label htmlFor="italic-check" className="text-xs">Italic</Label>
            </div>
          </div>
        </div>

        {/* Case */}
        <div>
          <Label className="text-xs">Case</Label>
          <Select value={typo.case} onValueChange={(v) => onUpdate({ case: v })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {caseOptions.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Size ratio + Line height */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Size Ratio</Label>
            <Input
              className="h-8 text-xs"
              type="number"
              step={0.01}
              min={0.1}
              max={2}
              value={typo.sizeRatio}
              onChange={(e) => onUpdate({ sizeRatio: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs">Line Height</Label>
            <Input
              className="h-8 text-xs"
              type="number"
              step={0.05}
              min={0.8}
              max={3}
              value={typo.lineHeight}
              onChange={(e) => onUpdate({ lineHeight: Number(e.target.value) })}
            />
          </div>
        </div>

        {/* Tracking + Align */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Tracking</Label>
            <Input
              className="h-8 text-xs"
              type="number"
              step={0.01}
              min={-0.1}
              max={0.5}
              value={typo.tracking}
              onChange={(e) => onUpdate({ tracking: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs">Align</Label>
            <Select value={typo.align} onValueChange={(v) => onUpdate({ align: v })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {alignOptions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Color */}
        <div>
          <Label className="text-xs">Color</Label>
          <div className="flex gap-2">
            <div
              className="size-8 shrink-0 rounded border border-border"
              style={{ backgroundColor: typo.color }}
            />
            <Input
              className="h-8 text-xs font-mono"
              value={typo.color}
              onChange={(e) => onUpdate({ color: e.target.value })}
            />
          </div>
        </div>

        {/* Scores */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Fit Score</Label>
            <Input
              className="h-8 text-xs"
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={typo.fitScore}
              onChange={(e) => onUpdate({ fitScore: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs">Detection Score</Label>
            <Input
              className="h-8 text-xs"
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={typo.detectionScore}
              onChange={(e) => onUpdate({ detectionScore: Number(e.target.value) })}
            />
          </div>
        </div>

        {/* Sample line count */}
        <div>
          <Label className="text-xs">Sample Line Count</Label>
          <Input
            className="h-8 text-xs"
            type="number"
            min={1}
            value={typo.sampleLineCount}
            onChange={(e) => onUpdate({ sampleLineCount: Number(e.target.value) })}
          />
        </div>
      </div>

      {/* Sample box */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Sample Box
        </h4>
        <div className="grid grid-cols-2 gap-2">
          {(["x", "y", "width", "height"] as const).map((prop) => (
            <div key={prop}>
              <Label className="text-xs capitalize">{prop}</Label>
              <Input
                className="h-8 text-xs"
                type="number"
                step={0.001}
                min={0}
                max={1}
                value={typo.sampleBox?.[prop] ?? 0}
                onChange={(e) => onUpdateBox({ [prop]: Number(e.target.value) })}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Font file (read-only) */}
      <div>
        <Label className="text-xs">Font File</Label>
        <p className="mt-1 rounded bg-muted px-2 py-1 font-mono text-[10px] break-all text-muted-foreground">
          {typo.fontFile || "(none)"}
        </p>
      </div>

      {/* Gate status */}
      <div className="flex items-center gap-2 rounded border border-border p-2">
        <span
          className={`size-3 rounded-full ${
            regionColor(typo, gates) === "green"
              ? "bg-emerald-400"
              : regionColor(typo, gates) === "yellow"
              ? "bg-amber-400"
              : "bg-red-400"
          }`}
        />
        <span className="text-xs">
          {regionColor(typo, gates) === "green"
            ? "Passes live gates"
            : regionColor(typo, gates) === "yellow"
            ? "Low fit score"
            : "Missing font file"}
        </span>
      </div>

      {/* Delete */}
      <Button variant="destructive" size="sm" className="w-full" onClick={onDelete}>
        <Trash2 className="size-3.5" />
        Delete Region
      </Button>
    </div>
  );
}
