"use client";

import { Images, Info, Search, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { AD_IMAGE_MAX_BYTES, AD_IMAGE_UPLOAD_TYPES, validateAssetUploadFile } from "@/lib/upload/asset-file";
import { filterAndSortAssets } from "@/lib/adstudio/library-contract";
import type { LibraryAssetModel } from "@/lib/adstudio/library-read-model";
import { uploadAdStudioMedia } from "./media-upload";

type AssetRole = LibraryAssetModel["role"];
type RoleFilter = AssetRole | "all";
type SortMode = "recent" | "name" | "role";
type UploadState = "queued" | "uploading" | "success" | "error" | "duplicate";
type UploadItem = { id: string; file: File; state: UploadState; error?: string };

const ROLE_ORDER: AssetRole[] = ["property", "person", "logo", "background"];
const ROLE_META: Record<AssetRole, { label: string; plural: string }> = {
  property: { label: "Property", plural: "Property" },
  person: { label: "Person", plural: "People" },
  logo: { label: "Logo", plural: "Logos" },
  background: { label: "Background", plural: "Backgrounds" },
};

type MediaLibraryProps = {
  workspaceId: string;
  brandKitId: string;
  assets: LibraryAssetModel[];
  nextAssetCursor: string | null;
  /** Render inside the unified Library surface without repeating its page head. */
  embedded?: boolean;
};

export function MediaLibrary({ workspaceId, brandKitId, assets, nextAssetCursor: initialCursor, embedded = false }: MediaLibraryProps) {
  const [loadedAssets, setLoadedAssets] = useState(assets);
  const [nextCursor, setNextCursor] = useState(initialCursor);
  const [uploaded, setUploaded] = useState<LibraryAssetModel[]>([]);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<RoleFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [dragging, setDragging] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<LibraryAssetModel | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allAssets = useMemo(() => [...uploaded, ...loadedAssets], [loadedAssets, uploaded]);
  const counts = useMemo(() => {
    const result = Object.fromEntries(ROLE_ORDER.map((role) => [role, 0])) as Record<AssetRole, number>;
    allAssets.forEach((asset) => { result[asset.role] += 1; });
    return result;
  }, [allAssets]);
  const visibleAssets = useMemo(() => {
    return filterAndSortAssets(allAssets, { query, role: filter, sort });
  }, [allAssets, filter, query, sort]);

  function openPicker() { inputRef.current?.click(); }
  function chooseFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;
    if (!brandKitId) { toast.error("Set up your brand before uploading images."); return; }
    const knownKeys = new Set(uploadItems.map((item) => fileKey(item.file)));
    const next: UploadItem[] = [];
    for (const file of files) {
      const validationError = validateAssetUploadFile(file, { acceptedTypes: AD_IMAGE_UPLOAD_TYPES, maxBytes: AD_IMAGE_MAX_BYTES, typeError: "Use a JPG, PNG, or WebP image.", sizeError: "Use an image under 8 MB." });
      if (validationError) {
        next.push({ id: `${fileKey(file)}-invalid`, file, state: "error", error: validationError });
        continue;
      }
      const id = `${fileKey(file)}-${crypto.randomUUID()}`;
      if (knownKeys.has(fileKey(file))) { next.push({ id, file, state: "duplicate", error: "Already queued in this upload." }); continue; }
      knownKeys.add(fileKey(file));
      next.push({ id, file, state: "queued" });
    }
    setUploadItems((current) => [...current, ...next]);
    void processUploads(next.filter((item) => item.state === "queued"));
    if (inputRef.current) inputRef.current.value = "";
  }

  async function processUploads(items: UploadItem[]) {
    for (const item of items) {
      setUploadItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, state: "uploading", error: undefined } : candidate));
      try {
        const result = await uploadAdStudioMedia({ file: item.file, workspaceId, brandKitId });
        setUploaded((current) => [{ id: `upload-${item.id}`, src: result.src, fullSrc: result.src, label: item.file.name, type: "uploaded_asset", role: "property", width: null, height: null, dimensionsLabel: null, createdAt: new Date().toISOString(), lastUsedAt: null, usageCount: null }, ...current]);
        setUploadItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, state: "success" } : candidate));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not upload that image.";
        setUploadItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, state: "error", error: message } : candidate));
      }
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ wave: "library", kind: "assets", limit: "24", cursor: nextCursor });
      const response = await fetch(`/api/adstudio/bootstrap?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load more assets.");
      const page = await response.json() as { items: LibraryAssetModel[]; nextCursor: string | null };
      setLoadedAssets((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load more assets."); }
    finally { setLoadingMore(false); }
  }

  const activeUploads = uploadItems.filter((item) => item.state === "queued" || item.state === "uploading");
  const uploadErrors = uploadItems.filter((item) => item.state === "error");
  const duplicates = uploadItems.filter((item) => item.state === "duplicate");
  return (
    <>
      <Toaster />
      <div className={embedded ? "w-full" : "mx-auto w-full max-w-[1120px] px-4 pb-28 pt-8 md:px-6 md:pb-16 md:pt-10"}>
      {!embedded ? <header className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="font-display text-[27px] font-extrabold tracking-[-.02em]">Assets</h1><p className="mt-2 max-w-[62ch] text-sm leading-6 text-muted-foreground">Keep your media ready for the next ad.</p></div>
        <Button type="button" size="pill" className="min-h-11" disabled={!brandKitId} onClick={openPicker}><Upload aria-hidden /> Upload assets</Button>
      </header> : null}
      <input ref={inputRef} type="file" accept={AD_IMAGE_UPLOAD_TYPES.join(",")} multiple hidden aria-label="Upload assets" onChange={(event) => chooseFiles(event.target.files ?? [])} />

      <section className={`${embedded ? "mt-0" : "mt-8"} rounded-(--r-panel) border border-(--line) bg-(--surface) p-3 shadow-card`} aria-label="Asset library controls">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative min-w-0 flex-1"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search filenames" aria-label="Search filenames" className="h-11 rounded-(--r-card) pl-9" /></label>
          <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label="Filter assets by role">
            <RoleButton active={filter === "all"} count={allAssets.length} onClick={() => setFilter("all")}>All</RoleButton>
            {ROLE_ORDER.map((role) => <RoleButton key={role} active={filter === role} count={counts[role]} onClick={() => setFilter(role)}>{ROLE_META[role].plural}</RoleButton>)}
          </div>
          <Select value={sort} onValueChange={(value) => setSort(value as SortMode)}>
            <SelectTrigger aria-label="Sort assets" className="h-11 w-full rounded-(--r-card) border-(--line-heavy) bg-(--surface) text-sm font-semibold text-foreground lg:w-auto"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="recent">Recently used</SelectItem><SelectItem value="name">Name</SelectItem><SelectItem value="role">Role</SelectItem></SelectContent>
          </Select>
        </div>
      </section>

      {(activeUploads.length || uploadErrors.length || duplicates.length) ? <UploadSummary items={uploadItems} onRetry={() => void processUploads(uploadItems.filter((item) => item.state === "error"))} onDismiss={() => setUploadItems([])} /> : null}
      <div className="mt-5 flex items-center justify-between gap-3 text-xs text-muted-foreground"><p aria-live="polite">{visibleAssets.length} {visibleAssets.length === 1 ? "asset" : "assets"}</p><p className="hidden sm:block">Private workspace media</p></div>

      {allAssets.length === 0 ? <EmptyAssets onBrowse={openPicker} /> : visibleAssets.length === 0 ? <div className="mt-4 rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-10 text-center"><h2 className="font-display text-[17px] font-extrabold">No matching assets</h2><p className="mt-1 text-sm text-muted-foreground">Try a different search or role filter.</p><Button type="button" variant="outline" size="pill" className="mt-5" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</Button></div> : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Dropzone dragging={dragging} setDragging={setDragging} onBrowse={openPicker} onFiles={chooseFiles} />
          {visibleAssets.map((asset) => <AssetCard key={asset.id} asset={asset} onOpen={() => setSelectedAsset(asset)} />)}
        </div>
      )}
      {nextCursor ? <div className="mt-6 flex justify-center"><Button type="button" variant="outline" size="pill" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more"}</Button></div> : null}
      <AssetDetails asset={selectedAsset} onClose={() => setSelectedAsset(null)} />
      </div>
    </>
  );
}

function RoleButton({ active, count, children, onClick }: { active: boolean; count: number; children: React.ReactNode; onClick: () => void }) { return <button type="button" aria-pressed={active} onClick={onClick} className={`min-h-11 rounded-full px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-(--surface-subtle)"}`}>{children}<span className={active ? "ml-1 opacity-70" : "ml-1 text-muted-foreground"}>{count}</span></button>; }

function Dropzone({ dragging, setDragging, onBrowse, onFiles }: { dragging: boolean; setDragging: (value: boolean) => void; onBrowse: () => void; onFiles: (files: FileList | File[]) => void }) {
  return <div onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); onFiles(event.dataTransfer.files); }} className={`flex aspect-square flex-col items-center justify-center rounded-(--r-card) border border-dashed p-4 text-center transition ${dragging ? "border-(--accent) bg-(--surface-subtle)" : "border-(--line-heavy) bg-(--surface)"}`}><span className="mb-3 grid size-10 place-items-center rounded-full bg-(--surface-subtle)"><Upload className="size-4" aria-hidden /></span><p className="text-sm font-semibold">Drop files to upload</p><p className="mt-1 text-xs leading-5 text-muted-foreground">JPG, PNG, or WebP · up to 8 MB</p><button type="button" onClick={onBrowse} className="mt-3 min-h-11 rounded px-2 text-xs font-bold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Browse files</button></div>;
}

function AssetCard({ asset, onOpen }: { asset: LibraryAssetModel; onOpen: () => void }) { return <Card className="group gap-0 overflow-hidden rounded-(--r-card) border-(--line) bg-(--surface) py-0 shadow-card transition motion-reduce:transition-none hover:-translate-y-0.5 hover:shadow-float"><button type="button" onClick={onOpen} className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"><div className="aspect-square w-full overflow-hidden bg-(--surface-subtle)"><img src={asset.src} alt={asset.label} width={640} height={640} loading="lazy" decoding="async" className="size-full object-cover" /></div><div className="space-y-1.5 p-3"><p className="truncate text-xs font-semibold" title={asset.label}>{asset.label}</p><p className="text-[11px] text-muted-foreground">{ROLE_META[asset.role].label} · {asset.dimensionsLabel ?? "Dimensions unavailable"}</p><p className="truncate text-[11px] text-muted-foreground">{recentUseLabel(asset)}</p></div></button></Card>; }

function AssetDetails({ asset, onClose }: { asset: LibraryAssetModel | null; onClose: () => void }) { return <Sheet open={Boolean(asset)} onOpenChange={(open) => { if (!open) onClose(); }}><SheetContent side="right" className="w-full border-(--line) sm:max-w-md"><SheetHeader className="border-b border-(--line) p-6"><SheetTitle className="font-display text-[17px] font-extrabold">Asset details</SheetTitle><SheetDescription>Review this workspace asset before using it in an ad.</SheetDescription></SheetHeader>{asset ? <div className="flex-1 overflow-y-auto p-6"><div className="overflow-hidden rounded-(--r-card) border border-(--line) bg-(--surface-subtle)"><img src={asset.fullSrc || asset.src} alt={asset.label} width={960} height={960} className="max-h-[320px] w-full object-contain" /></div><dl className="mt-6 divide-y divide-(--line) text-sm"><Detail label="Filename" value={asset.label} /><Detail label="Role" value={ROLE_META[asset.role].label} /><Detail label="Dimensions" value={asset.dimensionsLabel ?? "Unavailable"} /><Detail label="Recent use" value={recentUseLabel(asset)} /></dl><div className="mt-6 rounded-(--r-card) border border-(--line) bg-(--surface-subtle)/60 p-4 text-xs leading-5 text-muted-foreground"><Info className="mb-2 size-4" aria-hidden /><p>Rename, role changes, creating an ad from this asset, and deletion are not available in the current asset API. This asset remains private to your workspace.</p></div></div> : null}<SheetFooter className="border-t border-(--line) p-6"><Button type="button" variant="outline" size="pill" onClick={onClose}>Close</Button></SheetFooter></SheetContent></Sheet>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="max-w-[60%] text-right font-semibold">{value}</dd></div>; }

function EmptyAssets({ onBrowse }: { onBrowse: () => void }) { return <div className="mt-4 flex min-h-[280px] flex-col items-center justify-center rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 p-8 text-center"><span className="mb-3 grid size-10 place-items-center rounded-full bg-(--surface-subtle)"><Images className="size-5 text-muted-foreground" aria-hidden /></span><h2 className="font-display text-[17px] font-extrabold">Upload your first asset</h2><p className="mt-1 max-w-[38ch] text-sm text-muted-foreground">Add property images, people, logos, or backgrounds to reuse in your ads.</p><Button type="button" size="pill" className="mt-5 min-h-11" onClick={onBrowse}><Upload aria-hidden /> Upload assets</Button></div>; }

function UploadSummary({ items, onRetry, onDismiss }: { items: UploadItem[]; onRetry: () => void; onDismiss: () => void }) { const done = items.filter((item) => item.state === "success").length; const active = items.filter((item) => item.state === "queued" || item.state === "uploading").length; const errors = items.filter((item) => item.state === "error"); const duplicates = items.filter((item) => item.state === "duplicate"); return <div className="mt-4 rounded-(--r-card) border border-(--line) bg-(--surface) p-4" role="status" aria-live="polite"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{active ? `Uploading ${done + active} file${done + active === 1 ? "" : "s"}…` : `${done} upload${done === 1 ? "" : "s"} complete`}</p><p className="mt-1 text-xs text-muted-foreground">{errors.length ? `${errors.length} failed` : ""}{errors.length && duplicates.length ? " · " : ""}{duplicates.length ? `${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"} skipped` : ""}</p></div><button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-full text-muted-foreground hover:bg-(--surface-subtle) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onDismiss} aria-label="Dismiss upload summary"><X className="size-4" aria-hidden /></button></div>{active ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-(--surface-subtle)" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} /></div> : null}{errors.length ? <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-(--ui-error)"><span>{errors.map((item) => `${item.file.name}: ${item.error}`).join(" · ")}</span><Button type="button" variant="outline" size="sm" onClick={onRetry}>Retry failed</Button></div> : null}<div className="sr-only">{items.filter((item) => item.state === "success").map((item) => `${item.file.name} uploaded`).join(" ")}</div></div>; }

function recentUseLabel(asset: LibraryAssetModel): string { if (asset.usageCount !== null && asset.usageCount > 0) return `Used in ${asset.usageCount} ad${asset.usageCount === 1 ? "" : "s"}`; if (asset.lastUsedAt) return `Used ${formatDate(asset.lastUsedAt)}`; return "No recorded use"; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "recently" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date); }
function dateValue(value: string | null): number { const parsed = value ? Date.parse(value) : 0; return Number.isFinite(parsed) ? parsed : 0; }
function fileKey(file: File): string { return `${file.name.toLocaleLowerCase()}-${file.size}-${file.lastModified}`; }
