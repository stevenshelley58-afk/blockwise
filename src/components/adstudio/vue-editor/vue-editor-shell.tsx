"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ImagePlus, Save, Sparkles, SlidersHorizontal, Type } from "lucide-react";
import type { AdDocumentParsed } from "../../../../packages/ad-template-contract/src/schema";
import type { AdTemplate, Placement } from "../../../../packages/ad-template-contract/src/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { META_COPY_CTA_VALUES } from "@/lib/adstudio/meta-copy-contract";
import { templateAssetProxyUrl } from "@/lib/adstudio/pack-gallery";
import { uploadCustomerImage } from "../editor/customer-image-upload";
import { NativeMetaPreview, type NativeMetaCopy } from "./native-meta-preview";
import { applyTextValuesToScenes, convertTemplateToFabricScenes, hydrateFabricSceneImages, isFabricScene, nativeImageSlots, readVueNativeEditor, replaceNativeImageInScenes, templateTextValues, textValuesFromScenes, type FabricScene, type VueNativeEditorDocument } from "./fabric-scene";

const CHANNEL = "blockwise.vue-editor";
const VERSION = 1;
type Envelope = { channel: typeof CHANNEL; version: 1; type: string; requestId?: string; payload?: any };
type Asset = { id: string; name: string; url: string; thumbnailUrl?: string };
type ExportResult = { placement: Placement; scene: FabricScene; pngDataUrl: string };

export function VueEditorShell({ pack, adId, workspaceId, initialDocument, initialRevision = 0, sourceAdId, businessName, logoUrl, libraryAssets }: {
  pack: AdTemplate; adId: string; workspaceId: string; initialDocument: AdDocumentParsed; initialRevision?: number; sourceAdId?: string;
  businessName: string; logoUrl: string | null; libraryAssets: Asset[];
}) {
  const router = useRouter();
  const iframe = useRef<HTMLIFrameElement | null>(null);
  const pending = useRef(new Map<string, { placement: Placement; resolve: (value: ExportResult) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>());
  const native = useMemo(() => readVueNativeEditor(initialDocument) ?? convertTemplateToFabricScenes({ pack, adId, document: initialDocument, sourceAdId }), [adId, initialDocument, pack, sourceAdId]);
  const scenesRef = useRef({ feed: native.feed, story: native.story });
  const [editSerial, setEditSerial] = useState(0);
  const changeVersion = useRef(0);
  const saveAction = useRef<() => void>(() => undefined);
  const snapshotPending = useRef(new Map<string, { resolve: (value: { feed: ExportResult; story: ExportResult }) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>());
  const [copyOpen, setCopyOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [active, setActive] = useState<Placement>("feed");
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(!initialDocument.nativeEditor);
  const [saving, setSaving] = useState(false);
  const [savedRevision, setSavedRevision] = useState(initialRevision);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<Placement, string | null>>({ feed: null, story: null });
  const [copy, setCopy] = useState<NativeMetaCopy>(() => templateMetaCopy(pack, initialDocument));
  const [textValues, setTextValues] = useState(() => ({ ...templateTextValues(pack, initialDocument), ...textValuesFromScenes(native) }));
  const [brief, setBrief] = useState("");
  const [proposal, setProposal] = useState<{ onImage: Record<string, string>; copy: Partial<NativeMetaCopy>; source: string } | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [assetRequest, setAssetRequest] = useState<{ requestId: string; kind: "upload" | "choose" } | null>(null);
  const [photoSlot, setPhotoSlot] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const send = useCallback((type: string, payload?: unknown, requestId?: string) => {
    iframe.current?.contentWindow?.postMessage({ channel: CHANNEL, version: VERSION, type, ...(requestId ? { requestId } : {}), ...(payload === undefined ? {} : { payload }) } satisfies Envelope, window.location.origin);
  }, []);

  const replaceScenes = useCallback((next: { feed: FabricScene; story: FabricScene }, markDirty = true) => {
    scenesRef.current = next;
    if (markDirty) { changeVersion.current += 1; setEditSerial(value => value + 1); setDirty(true); }
  }, []);

  const exportPlacement = useCallback((placement: Placement) => new Promise<ExportResult>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pending.current.delete(requestId);
      reject(new Error(`${placement === "feed" ? "Feed" : "Story"} export timed out. Try again.`));
    }, 20_000);
    pending.current.set(requestId, { placement, resolve, reject, timeout });
    send("export", { placement, format: "both" }, requestId);
  }), [send]);

  const snapshotAll = useCallback(() => new Promise<{ feed: ExportResult; story: ExportResult }>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => { snapshotPending.current.delete(requestId); reject(new Error("Saving the artwork timed out. Try again.")); }, 30_000);
    snapshotPending.current.set(requestId, { resolve, reject, timeout });
    send("snapshot", undefined, requestId);
  }), [send]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty || designOpen) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, designOpen]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<Envelope>) => {
      if (event.origin !== window.location.origin || event.source !== iframe.current?.contentWindow) return;
      const message = event.data;
      if (!message || message.channel !== CHANNEL || message.version !== VERSION) return;
      const payload = message.payload ?? {};
      if (message.type === "ready") {
        void Promise.all(initialDocument.nativeEditor ? [Promise.resolve(scenesRef.current.feed), Promise.resolve(scenesRef.current.story)] : [hydrateFabricSceneImages(scenesRef.current.feed), hydrateFabricSceneImages(scenesRef.current.story)])
          .then(([feed, story]) => {
            replaceScenes({ feed, story }, false);
            const fonts = pack.fonts.flatMap(font => {
              const asset = Object.entries(pack.assets).find(([, declaration]) => declaration.fileName === font.file);
              const url = asset ? templateAssetProxyUrl(pack.templateId, asset[0], adId) : null;
              return url ? [{ family: `Blockwise_${encodeURIComponent(pack.templateId)}_${encodeURIComponent(font.file)}`, url }] : [];
            });
            send("initialize", { placements: { feed: { width: 1080, height: 1350, scene: feed }, story: { width: 1080, height: 1920, scene: story } }, activePlacement: "feed", fonts, templates: [{ id: pack.templateId, name: "Reset to opened design", placements: { feed, story } }], assets: libraryAssets });
          })
          .catch(cause => setError(cause instanceof Error ? cause.message : "The template could not be converted for the new editor."));
      } else if (message.type === "initialized") {
        setReady(true);
        void exportPlacement("feed").catch(cause => setError(cause.message));
        void exportPlacement("story").catch(cause => setError(cause.message));
      } else if (message.type === "placement-loaded") {
        if (payload.placement === "feed" || payload.placement === "story") setActive(payload.placement);
      } else if (message.type === "changed") {
        const placement = payload.placement as Placement;
        const expectedHeight = placement === "feed" ? 1350 : 1920;
        if ((placement === "feed" || placement === "story") && isFabricScene(payload.scene, 1080, expectedHeight)) {
          const next = { ...scenesRef.current, [placement]: payload.scene };
          replaceScenes(next);
          setTextValues(current => ({ ...current, ...textValuesFromScenes(next) }));
          setError(null);
        }
      } else if (message.type === "exported" && message.requestId) {
        const request = pending.current.get(message.requestId);
        if (!request) return;
        pending.current.delete(message.requestId); clearTimeout(request.timeout);
        const height = request.placement === "feed" ? 1350 : 1920;
        const scene = isFabricScene(payload.scene, 1080, height) ? payload.scene : scenesRef.current[request.placement];
        if (typeof payload.pngDataUrl !== "string" || !payload.pngDataUrl.startsWith("data:image/png;base64,")) return request.reject(new Error("The editor did not return a PNG export."));
        setPreview(current => ({ ...current, [request.placement]: payload.pngDataUrl }));
        request.resolve({ placement: request.placement, scene, pngDataUrl: payload.pngDataUrl });
      } else if (message.type === "snapshot" && message.requestId) {
        const request = snapshotPending.current.get(message.requestId);
        if (!request) return;
        snapshotPending.current.delete(message.requestId); clearTimeout(request.timeout);
        const valid = (value: ExportResult, height: number) => value && isFabricScene(value.scene, 1080, height) && typeof value.pngDataUrl === "string" && value.pngDataUrl.startsWith("data:image/png;base64,");
        if (!valid(payload.feed, 1350) || !valid(payload.story, 1920)) request.reject(new Error("The editor returned an incomplete artwork snapshot."));
        else {
          const next = { feed: payload.feed.scene, story: payload.story.scene };
          replaceScenes(next, false);
          setTextValues(current => ({ ...current, ...textValuesFromScenes(next) }));
          setPreview({ feed: payload.feed.pngDataUrl, story: payload.story.pngDataUrl });
          request.resolve({ feed: payload.feed, story: payload.story });
        }
      } else if (message.type === "saved") {
        saveAction.current();
      } else if (message.type === "ai-request") {
        setCopyOpen(true);
        setBrief(typeof payload.selection?.text === "string" ? payload.selection.text : "");
      } else if (message.type === "asset-request" && message.requestId && (payload.kind === "upload" || payload.kind === "choose")) {
        setPhotosOpen(true);
        setAssetRequest({ requestId: message.requestId, kind: payload.kind });
        if (payload.kind === "upload") queueMicrotask(() => fileInput.current?.click());
      } else if (message.type === "error") {
        const cause = new Error(typeof payload.message === "string" ? payload.message : "The editor could not complete that action.");
        setError(cause.message);
        if (message.requestId) for (const queue of [pending.current, snapshotPending.current]) {
          const request = queue.get(message.requestId);
          if (request) { clearTimeout(request.timeout); request.reject(cause); queue.delete(message.requestId); }
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => { window.removeEventListener("message", onMessage); for (const item of pending.current.values()) { clearTimeout(item.timeout); item.reject(new Error("Editor closed.")); } pending.current.clear(); for (const item of snapshotPending.current.values()) { clearTimeout(item.timeout); item.reject(new Error("Editor closed.")); } snapshotPending.current.clear(); };
  }, [adId, exportPlacement, libraryAssets, pack, replaceScenes, send]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => { void exportPlacement(active).catch(() => undefined); }, 500);
    return () => clearTimeout(timer);
  }, [active, exportPlacement, ready, editSerial]);

  const applyValues = (values: Record<string, string>, nextCopy = copy) => {
    const next = applyTextValuesToScenes(scenesRef.current, values);
    replaceScenes(next);
    setTextValues(current => ({ ...current, ...values }));
    setCopy(nextCopy);
    send("load-scene", { placement: "feed", scene: next.feed });
    send("load-scene", { placement: "story", scene: next.story });
  };

  const propose = async () => {
    setProposalBusy(true); setError(null);
    try {
      const response = await fetch(`/api/adstudio/ads/${encodeURIComponent(adId)}/copy-proposal?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief, copy }) });
      const body = await response.json().catch(() => ({})) as { onImage?: Record<string, string>; copy?: Partial<NativeMetaCopy>; source?: string; error?: string };
      if (!response.ok || !body.copy) throw new Error(body.error ?? "Copy proposal failed.");
      setProposal({ onImage: body.onImage ?? {}, copy: body.copy, source: body.source ?? "AI" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Copy proposal failed."); }
    finally { setProposalBusy(false); }
  };

  const save = useCallback(async () => {
    if (!ready || saving || transitioning || photoBusy) return false;
    const savingVersion = changeVersion.current;
    setSaving(true); setError(null);
    try {
      // Fresh exports freeze both scenes and both rendered placements together.
      const { feed, story } = await snapshotAll();
      const nativeEditor: VueNativeEditorDocument = { engine: "vue-fabric-editor", version: 1, feed: feed.scene, story: story.scene, ...(native.sourceAdId || sourceAdId ? { sourceAdId: native.sourceAdId ?? sourceAdId } : {}) };
      const document = { ...initialDocument, sharedTextValues: textValuesFromScenes(nativeEditor), metaPrimaryText: copy.primaryText, metaHeadline: copy.headline, metaDescription: copy.description, metaCta: copy.cta, nativeEditor, revision: savedRevision + 1 };
      const response = await fetch(`/api/adstudio/ads/${encodeURIComponent(adId)}/vue-save?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document, expectedRevision: savedRevision, exports: { feed: { mimeType: "image/png", base64: feed.pngDataUrl.slice("data:image/png;base64,".length) }, story: { mimeType: "image/png", base64: story.pngDataUrl.slice("data:image/png;base64,".length) } } }) });
      const body = await response.json().catch(() => ({})) as { ad?: { revisionNumber?: number }; error?: string };
      if (!response.ok || typeof body.ad?.revisionNumber !== "number") throw new Error(body.error ?? "The ad could not be saved.");
      setSavedRevision(body.ad.revisionNumber); setDirty(changeVersion.current !== savingVersion); setPreview({ feed: feed.pngDataUrl, story: story.pngDataUrl });
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The ad could not be saved."); return false; }
    finally { setSaving(false); }
  }, [adId, copy, snapshotAll, initialDocument, native.sourceAdId, ready, saving, transitioning, photoBusy, savedRevision, sourceAdId, workspaceId]);

  saveAction.current = () => { void save(); };

  const review = async () => {
    if (dirty || designOpen || savedRevision === 0) { const ok = await save(); if (!ok) return; }
    router.push(`/ad-studio/templates/${encodeURIComponent(pack.templateId)}/publish?adId=${encodeURIComponent(adId)}`);
  };
  const leave = () => { if ((!dirty && !designOpen) || window.confirm("You have unsaved changes. Leave this ad?")) router.push("/ad-studio/library?view=ads"); };
  const choosePlacement = (placement: Placement) => { setActive(placement); send("load-placement", { placement }); };

  const syncArtwork = async (detectChanges = false) => {
    const before = JSON.stringify(scenesRef.current);
    const snapshot = await snapshotAll();
    if (detectChanges && before !== JSON.stringify({ feed: snapshot.feed.scene, story: snapshot.story.scene })) { changeVersion.current += 1; setDirty(true); }
    return { feed: snapshot.feed.scene, story: snapshot.story.scene };
  };
  const toggleDesign = async () => {
    if (!ready || transitioning || saving || photoBusy) return;
    setTransitioning(true); setError(null);
    try { await syncArtwork(designOpen); setCopyOpen(false); setPhotosOpen(false); setDesignOpen(current => !current); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The artwork could not be updated. Try again."); }
    finally { setTransitioning(false); }
  };
  const applyPhoto = async (key: string, src: string) => {
    setPhotoBusy(true); setError(null);
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error("That image could not be read. Try another file.")); image.src = src;
      });
      const next = replaceNativeImageInScenes(scenesRef.current, key, src, dimensions);
      replaceScenes(next); send("load-scene", { placement: "feed", scene: next.feed }); send("load-scene", { placement: "story", scene: next.story });
      setPhotosOpen(false); setPhotoSlot(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The photo could not be changed."); }
    finally { setPhotoBusy(false); }
  };
  const adoptPhoto = async (asset: Asset) => {
    if (!photoSlot) return;
    setPhotoBusy(true); setError(null);
    try {
      const response = await fetch("/api/adstudio/ads/" + encodeURIComponent(adId) + "/media?workspaceId=" + encodeURIComponent(workspaceId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "adopt", sourceAssetId: asset.id }) });
      const body = await response.json().catch(() => ({})) as { ref?: string; error?: string };
      if (!response.ok || !body.ref) throw new Error(body.error ?? "The image could not be added.");
      await applyPhoto(photoSlot, body.ref);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The image could not be added."); setPhotoBusy(false); }
  };

  const completeAsset = async (asset: Asset) => {
    if (!assetRequest || photoBusy) return;
    setPhotoBusy(true); setError(null);
    try {
      const response = await fetch("/api/adstudio/ads/" + encodeURIComponent(adId) + "/media?workspaceId=" + encodeURIComponent(workspaceId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "adopt", sourceAssetId: asset.id }) });
      const body = await response.json().catch(() => ({})) as { ref?: string; error?: string };
      if (!response.ok || !body.ref) throw new Error(body.error ?? "The image could not be added.");
      send("asset-result", { requestId: assetRequest.requestId, asset: { ...asset, url: body.ref } }, assetRequest.requestId);
      await syncArtwork(true); setAssetRequest(null); setPhotosOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The image could not be added."); }
    finally { setPhotoBusy(false); }
  };
  const upload = async (file: File) => {
    if ((!assetRequest && !photoSlot) || photoBusy) return;
    setPhotoBusy(true); setError(null);
    try {
      const uploaded = await uploadCustomerImage({ file, adId, workspaceId });
      if (assetRequest) {
        send("asset-result", { requestId: assetRequest.requestId, asset: { id: uploaded.ref, name: file.name, url: uploaded.ref } }, assetRequest.requestId);
        await syncArtwork(true); setAssetRequest(null); setPhotosOpen(false);
      } else if (photoSlot) await applyPhoto(photoSlot, uploaded.ref);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The image could not be uploaded."); }
    finally { setPhotoBusy(false); }
  };
  const closePhotos = (open: boolean) => {
    if (photoBusy) return;
    if (!open && assetRequest) send("asset-result", { requestId: assetRequest.requestId, cancelled: true }, assetRequest.requestId);
    if (!open) { setAssetRequest(null); setPhotoSlot(null); }
    setPhotosOpen(open);
  };
  const updateCopy = (key: keyof NativeMetaCopy, value: string) => {
    setCopy(current => ({ ...current, [key]: value })); changeVersion.current += 1; setDirty(true);
  };

  const templateValues = Object.fromEntries(pack.textInputs.map(input => [input.key, input.placeholder]));
  const templateCopy = templateMetaCopy(pack);
  const status = saving ? "Saving…" : dirty ? "Unsaved changes" : savedRevision > 0 ? "Saved" : "Ready to save";

  const busy = !ready || saving || transitioning || photoBusy;
  const slots = nativeImageSlots(scenesRef.current);
  const survivingText = textValuesFromScenes(scenesRef.current);
  const sourceId = native.sourceAdId ?? sourceAdId;
  const errorAlert = error ? <Alert variant="destructive" className="shrink-0"><AlertCircle /><AlertTitle>Something needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null;
  const formats = <Tabs value={active} onValueChange={value => choosePlacement(value as Placement)}><TabsList aria-label="Ad format"><TabsTrigger disabled={busy} value="feed">Feed</TabsTrigger><TabsTrigger disabled={busy} value="story">Story</TabsTrigger></TabsList></Tabs>;

  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground" role="region" aria-label="New Ad Studio editor trial">
    <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-card px-3 py-2 sm:px-5">
      <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label="Back to ads" onClick={leave}><ArrowLeft className="size-4" /></Button>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{pack.metadata.title}</p><p className="text-xs text-muted-foreground" role="status" aria-live="polite">{status}</p></div>
      <div className="flex w-full justify-end gap-2 sm:w-auto">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void save()}><Save className="size-3.5" />{saving ? "Saving…" : "Save"}</Button>
        <Button type="button" size="sm" disabled={busy} onClick={() => void review()}>Review &amp; publish</Button>
      </div>
    </header>
    {!copyOpen && !photosOpen && errorAlert ? <div className="shrink-0 p-2">{errorAlert}</div> : null}
    <div className="relative min-h-0 flex-1">
      <div className={"absolute inset-0 " + (designOpen ? "visible" : "invisible pointer-events-none")} inert={!designOpen || busy} aria-hidden={!designOpen}>
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void toggleDesign()}>{transitioning ? "Updating…" : "Done designing"}</Button>
            {designOpen ? formats : null}
          </div>
          <iframe ref={iframe} src="/vue-ad-editor/" title="Vue Fabric ad editor" tabIndex={designOpen ? 0 : -1} className="min-h-0 w-full flex-1 border-0" sandbox="allow-scripts allow-same-origin allow-downloads" />
        </div>
      </div>
      {!designOpen ? <div className="relative grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] md:grid-cols-[112px_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)]">
        <div role="group" aria-label="Ad editing tools" className="col-start-1 row-start-3 grid grid-cols-3 gap-1 border-t border-border bg-card p-2 md:row-start-1 md:row-span-2 md:flex md:flex-col md:justify-start md:gap-2 md:border-t-0 md:border-r md:pt-4">
          <Button type="button" variant="ghost" arrow={null} className="h-14 min-w-0 rounded-(--r-ctl) px-1 text-xs md:h-18" disabled={busy} onClick={() => { setError(null); setPhotoSlot(null); setPhotosOpen(true); }}><span className="flex flex-col items-center gap-1"><ImagePlus className="size-5" /><span>Photos</span></span></Button>
          <Button type="button" variant="ghost" arrow={null} className="h-14 min-w-0 rounded-(--r-ctl) px-1 text-xs md:h-18" disabled={busy} onClick={() => { setError(null); setCopyOpen(true); }}><span className="flex flex-col items-center gap-1"><Type className="size-5" /><span>Words</span></span></Button>
          <Button type="button" variant="ghost" arrow={null} className="h-14 min-w-0 rounded-(--r-ctl) px-1 text-xs md:h-18" disabled={busy} onClick={() => void toggleDesign()}><span className="flex flex-col items-center gap-1"><SlidersHorizontal className="size-5" /><span>{transitioning ? "Updating…" : "Adjust design"}</span></span></Button>
        </div>
        <div className="col-start-1 row-start-1 flex items-center justify-center border-b border-border bg-card px-3 py-2 md:col-start-2">{formats}</div>
        <div className="col-start-1 row-start-2 min-h-0 min-w-0 overflow-y-auto bg-muted/40 p-4 sm:p-6 md:col-start-2" role="region" aria-label="Ad preview" tabIndex={0} aria-busy={!ready || transitioning}>
          {!ready ? <p className="py-12 text-center text-sm text-muted-foreground" role="status">Preparing your ad…</p> : <NativeMetaPreview placement={active} image={preview[active]} copy={copy} businessName={businessName} logoUrl={logoUrl} destinationUrl={initialDocument.destinationUrl} />}
        </div>
      </div> : null}
    </div>

    <Sheet open={copyOpen} onOpenChange={setCopyOpen}><SheetContent className="tw w-full overflow-y-auto bg-card sm:max-w-md" aria-describedby={undefined}>
      <SheetHeader><SheetTitle>Words</SheetTitle></SheetHeader>
      <div className="space-y-6 p-4">
        {errorAlert}
        <section className="space-y-3">
          <label className="block text-sm font-medium">What should the ad say?<textarea value={brief} onChange={event => setBrief(event.target.value)} rows={3} placeholder="What should this ad communicate?" className="mt-2 w-full resize-y rounded-(--r-ctl) border border-input bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
          <Button type="button" variant="outline" size="sm" disabled={proposalBusy || busy || !brief.trim()} onClick={() => void propose()}><Sparkles className="size-3.5" />{proposalBusy ? "Drafting…" : "Help me write"}</Button>
          {proposal ? <div className="space-y-3 rounded-(--r-ctl) border border-border p-3">
            <p className="text-sm font-semibold">Suggested wording</p>
            <div className="space-y-2 text-sm leading-relaxed">{Object.entries(proposal.onImage).map(([key,value]) => <p key={key}><strong>{pack.textInputs.find(input => input.key === key)?.label ?? key}: </strong>{value}</p>)}{proposal.copy.primaryText ? <p>{proposal.copy.primaryText}</p> : null}{proposal.copy.headline ? <p className="font-semibold">{proposal.copy.headline}</p> : null}{proposal.copy.description ? <p>{proposal.copy.description}</p> : null}</div>
            <p className="text-xs text-muted-foreground">Nothing changes until you apply it.</p>
            <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy} onClick={() => { applyValues(proposal.onImage, { ...copy, ...proposal.copy }); setProposal(null); }}>Apply proposal</Button><Button type="button" variant="ghost" size="sm" onClick={() => setProposal(null)}>Dismiss</Button></div>
          </div> : null}
        </section>
        <details open className="border-t border-border pt-4"><summary className="cursor-pointer text-sm font-semibold focus-visible:outline-ring">Text on image</summary><div className="mt-4 space-y-3">{pack.textInputs.filter(input => input.key in survivingText).map(input => <label key={input.key} className="block text-sm font-medium">{input.label}<Input disabled={busy} value={textValues[input.key] ?? ""} maxLength={input.maxLength} className="mt-1" onChange={event => applyValues({ [input.key]: event.target.value })} /></label>)}</div></details>
        <details className="border-t border-border pt-4"><summary className="cursor-pointer text-sm font-semibold focus-visible:outline-ring">Text with ad</summary><fieldset disabled={busy} className="mt-4 space-y-3"><CopyField label="Main message" value={copy.primaryText} multiline onChange={value => updateCopy("primaryText",value)} /><CopyField label="Headline" value={copy.headline} onChange={value => updateCopy("headline",value)} /><CopyField label="Description" value={copy.description} onChange={value => updateCopy("description",value)} /><label className="block text-sm font-medium">Ad button<Select disabled={busy} value={copy.cta} onValueChange={value => updateCopy("cta",value)}><SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger><SelectContent>{META_COPY_CTA_VALUES.map(value => <SelectItem key={value} value={value}>{value.replaceAll("_"," ").toLowerCase().replace(/^\w/,letter=>letter.toUpperCase())}</SelectItem>)}</SelectContent></Select></label></fieldset></details>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { if (window.confirm("Replace the wording with the template's original copy? Your design and photos will stay the same.")) { applyValues(templateValues,templateCopy); setProposal(null); } }}>Use template copy</Button>
      </div>
    </SheetContent></Sheet>

    <Sheet open={photosOpen} onOpenChange={closePhotos}><SheetContent className="tw w-full overflow-y-auto bg-card sm:max-w-md" aria-describedby={undefined}>
      <SheetHeader><SheetTitle>{photoSlot ? pack.imageInputs.find(input=>input.key===photoSlot)?.label ?? "Photo" : "Photos"}</SheetTitle></SheetHeader>
      <div className="space-y-4 p-4">
        {errorAlert}
        {photoBusy ? <p className="text-sm text-muted-foreground" role="status">Updating photo…</p> : null}
        {!photoSlot && !assetRequest ? <>
          {pack.imageInputs.length ? <p className="text-sm text-muted-foreground">Choose a photo to replace. The change applies wherever it appears.</p> : null}
          {pack.imageInputs.map(input => { const slot=slots.find(value=>value.key===input.key); return <div key={input.key}>
            <Button type="button" variant="outline" disabled={busy || !slot} className="h-auto w-full justify-start gap-3 p-3 text-left" onClick={()=>setPhotoSlot(input.key)}>{slot?.src ? <img src={slot.src} alt="" className="size-16 shrink-0 rounded-md object-cover" /> : <ImagePlus className="size-8 shrink-0" />}<span className="min-w-0 whitespace-normal">{input.label}</span></Button>
            {!slot ? <p className="mt-1 text-xs text-muted-foreground">Removed from this design. Use Adjust design to add another image.</p> : null}
          </div>; })}
          {!slots.length ? <><p className="text-sm text-muted-foreground">No template photos to replace. Add an image in the design tools.</p><Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>void toggleDesign()}>Adjust design</Button></> : null}
        </> : <>
          {photoSlot ? <Button type="button" variant="ghost" size="sm" disabled={photoBusy} onClick={()=>setPhotoSlot(null)}>Back to photos</Button> : null}
          <Button type="button" variant="outline" disabled={photoBusy} onClick={()=>fileInput.current?.click()}><ImagePlus className="size-4" />Upload photo</Button>
          <section className="space-y-3 border-t border-border pt-4"><h2 className="text-sm font-semibold">Your library</h2>{libraryAssets.length ? <div className="grid grid-cols-2 gap-3">{libraryAssets.map(asset=><Button type="button" variant="outline" key={asset.id} disabled={photoBusy} onClick={()=>void (assetRequest ? completeAsset(asset) : adoptPhoto(asset))} className="h-auto flex-col items-stretch overflow-hidden p-0 text-left"><img src={asset.thumbnailUrl ?? asset.url} alt="" className="aspect-square w-full object-cover" /><span className="block max-w-full truncate p-2 text-xs font-medium">{asset.name}</span></Button>)}</div> : <p className="text-sm text-muted-foreground">No photos saved yet. Upload one to use in this ad.</p>}</section>
        </>}
      </div>
    </SheetContent></Sheet>
    <input ref={fileInput} type="file" aria-label="Upload a photo" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event=>{ const file=event.target.files?.[0]; if(file) void upload(file); event.currentTarget.value=""; }} />
    {sourceId ? <div className="shrink-0 border-t border-border bg-card px-3 py-2 text-center text-xs text-muted-foreground">Trial copy. <a className="font-medium text-foreground underline underline-offset-4" href={"/ad-studio/ads/"+encodeURIComponent(sourceId)} onClick={event=>{ if((dirty||designOpen)&&!window.confirm("You have unsaved changes. Open the original ad?")) event.preventDefault(); }}>Open original ad</a></div> : null}
  </div>;
}

function CopyField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return <label className="block text-sm font-medium">{label}{multiline ? <textarea value={value} rows={4} className="mt-1 w-full resize-y rounded-(--r-ctl) border border-input bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" onChange={event=>onChange(event.target.value)} /> : <Input value={value} className="mt-1" onChange={event=>onChange(event.target.value)} />}</label>;
}
function templateMetaCopy(pack: AdTemplate, document?: AdDocumentParsed): NativeMetaCopy {
  return {
    primaryText: document?.nativeEditor ? document.metaPrimaryText : document?.metaPrimaryText || pack.metadata.metaCopyDefaults.primaryText[0] || "",
    headline: document?.nativeEditor ? document.metaHeadline : document?.metaHeadline || pack.metadata.metaCopyDefaults.headlines[0] || "",
    description: document?.nativeEditor ? document.metaDescription : document?.metaDescription || pack.metadata.metaCopyDefaults.descriptions[0] || "",
    cta: document?.metaCta || pack.metadata.metaCopyDefaults.cta || "LEARN_MORE",
  };
}
