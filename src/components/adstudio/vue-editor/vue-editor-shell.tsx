"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ImagePlus, Save, Sparkles } from "lucide-react";
import type { AdDocumentParsed } from "../../../../packages/ad-template-contract/src/schema";
import type { AdTemplate, Placement } from "../../../../packages/ad-template-contract/src/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { META_COPY_CTA_VALUES } from "@/lib/adstudio/meta-copy-contract";
import { templateAssetProxyUrl } from "@/lib/adstudio/pack-gallery";
import { uploadCustomerImage } from "../editor/customer-image-upload";
import { NativeMetaPreview, type NativeMetaCopy } from "./native-meta-preview";
import { applyTextValuesToScenes, convertTemplateToFabricScenes, hydrateFabricSceneImages, isFabricScene, readVueNativeEditor, templateTextValues, textValuesFromScenes, type FabricScene, type VueNativeEditorDocument } from "./fabric-scene";

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
  const [sideTab, setSideTab] = useState("copy");
  const [sideOpen, setSideOpen] = useState(false);
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
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

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
        replaceScenes({ ...scenesRef.current, [request.placement]: scene }, false);
        setPreview(current => ({ ...current, [request.placement]: payload.pngDataUrl }));
        request.resolve({ placement: request.placement, scene, pngDataUrl: payload.pngDataUrl });
      } else if (message.type === "snapshot" && message.requestId) {
        const request = snapshotPending.current.get(message.requestId);
        if (!request) return;
        snapshotPending.current.delete(message.requestId); clearTimeout(request.timeout);
        const valid = (value: ExportResult, height: number) => value && isFabricScene(value.scene, 1080, height) && typeof value.pngDataUrl === "string" && value.pngDataUrl.startsWith("data:image/png;base64,");
        if (!valid(payload.feed, 1350) || !valid(payload.story, 1920)) request.reject(new Error("The editor returned an incomplete artwork snapshot."));
        else request.resolve({ feed: payload.feed, story: payload.story });
      } else if (message.type === "saved") {
        saveAction.current();
      } else if (message.type === "ai-request") {
        setSideTab("copy"); setSideOpen(true);
        setBrief(typeof payload.selection?.text === "string" ? payload.selection.text : "");
      } else if (message.type === "asset-request" && message.requestId && (payload.kind === "upload" || payload.kind === "choose")) {
        setSideTab("copy"); setSideOpen(true);
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
    if (!ready || saving) return false;
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
  }, [adId, copy, snapshotAll, initialDocument, native.sourceAdId, ready, saving, savedRevision, sourceAdId, workspaceId]);

  saveAction.current = () => { void save(); };

  const review = async () => {
    if (dirty || savedRevision === 0) { const ok = await save(); if (!ok) return; }
    router.push(`/ad-studio/templates/${encodeURIComponent(pack.templateId)}/publish?adId=${encodeURIComponent(adId)}`);
  };
  const leave = () => { if (!dirty || window.confirm("You have unsaved changes. Leave this ad?")) router.push("/ad-studio/library?view=ads"); };
  const choosePlacement = (placement: Placement) => { setActive(placement); send("load-placement", { placement }); };

  const completeAsset = async (asset: Asset) => {
    if (!assetRequest) return;
    try {
      const response = await fetch(`/api/adstudio/ads/${encodeURIComponent(adId)}/media?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "adopt", sourceAssetId: asset.id }) });
      const body = await response.json().catch(() => ({})) as { ref?: string; error?: string };
      if (!response.ok || !body.ref) throw new Error(body.error ?? "The image could not be added.");
      send("asset-result", { requestId: assetRequest.requestId, asset: { ...asset, url: body.ref } }, assetRequest.requestId); setAssetRequest(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The image could not be added."); }
  };
  const upload = async (file: File) => {
    if (!assetRequest) return;
    try {
      const uploaded = await uploadCustomerImage({ file, adId, workspaceId });
      send("asset-result", { requestId: assetRequest.requestId, asset: { id: uploaded.ref, name: file.name, url: uploaded.ref } }, assetRequest.requestId); setAssetRequest(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The image could not be uploaded."); }
  };

  const templateValues = Object.fromEntries(pack.textInputs.map(input => [input.key, input.placeholder]));
  const templateCopy = templateMetaCopy(pack);
  const status = saving ? "Saving…" : dirty ? "Unsaved changes" : savedRevision > 0 ? "Saved" : "Ready to save";

  return <div className="flex h-full min-h-0 flex-col bg-background text-foreground" role="region" aria-label="New Ad Studio editor trial">
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-2 py-1.5 md:px-4">
      <Button type="button" variant="ghost" size="icon" aria-label="Back to ads" onClick={leave}><ArrowLeft className="size-4" /></Button>
      <div className="min-w-0"><p className="truncate text-sm font-semibold">{pack.metadata.title}</p><p className="text-[11px] text-muted-foreground" role="status" aria-live="polite">{status}</p></div>
      <div className="ml-auto flex flex-wrap items-center gap-1"><Button type="button" variant="ghost" size="sm" onClick={() => { setSideTab("copy"); setSideOpen(true); }}>Copy &amp; AI</Button><Button type="button" variant="ghost" size="sm" onClick={() => { setSideTab("preview"); setSideOpen(true); }}>Ad preview</Button><Tabs value={active} onValueChange={value => choosePlacement(value as Placement)}><TabsList><TabsTrigger value="feed">Feed</TabsTrigger><TabsTrigger value="story">Story</TabsTrigger></TabsList></Tabs><Button type="button" variant="outline" size="sm" disabled={!ready || saving} onClick={() => void save()}><Save className="size-3.5" />{saving ? "Saving…" : "Save"}</Button><Button type="button" size="sm" disabled={!ready || saving} onClick={() => void review()}>Review &amp; publish</Button></div>
    </header>
    {error ? <Alert variant="destructive" className="m-2 w-auto shrink-0"><AlertCircle /><AlertTitle>Editor needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    <div className="relative grid min-h-0 flex-1 grid-cols-1">
      <div className="relative min-h-0 bg-(--ink)">
        {!ready ? <div className="absolute inset-0 z-10 grid place-items-center bg-(--ink) text-sm text-white/70">Loading editor…</div> : null}
        <iframe ref={iframe} src="/vue-ad-editor/" title="Vue Fabric ad editor" className="size-full border-0" sandbox="allow-scripts allow-same-origin allow-downloads" />
      </div>
      <Sheet open={sideOpen} onOpenChange={setSideOpen}><SheetContent className="tw w-full overflow-y-auto bg-card sm:max-w-md" aria-describedby={undefined}><SheetHeader><SheetTitle>Ad copy and preview</SheetTitle></SheetHeader>
        <Tabs value={sideTab} onValueChange={setSideTab} className="min-h-full gap-0"><TabsList className="sticky top-0 z-10 w-full rounded-none border-b border-border bg-card p-2"><TabsTrigger value="copy">Copy &amp; AI</TabsTrigger><TabsTrigger value="preview">Preview</TabsTrigger></TabsList>
          <TabsContent value="copy" className="space-y-5 p-4"><section><div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">On-image text</h2><Button type="button" variant="ghost" size="sm" onClick={() => applyValues(templateValues, templateCopy)}>Use template copy</Button></div><div className="mt-3 space-y-3">{pack.textInputs.map(input => <label key={input.key} className="block text-xs font-medium">{input.label}<Input value={textValues[input.key] ?? ""} maxLength={input.maxLength} className="mt-1" onChange={event => applyValues({ [input.key]: event.target.value })} /></label>)}</div></section>
            <section className="border-t border-border pt-4"><h2 className="text-sm font-semibold">Meta copy</h2><div className="mt-3 space-y-3"><CopyField label="Primary text" value={copy.primaryText} onChange={value => { setCopy(current => ({ ...current, primaryText: value })); changeVersion.current += 1; setDirty(true); }} /><CopyField label="Headline" value={copy.headline} onChange={value => { setCopy(current => ({ ...current, headline: value })); changeVersion.current += 1; setDirty(true); }} /><CopyField label="Description" value={copy.description} onChange={value => { setCopy(current => ({ ...current, description: value })); changeVersion.current += 1; setDirty(true); }} /><label className="block text-xs font-medium">Call to action<Select value={copy.cta} onValueChange={value => { setCopy(current => ({ ...current, cta: value })); changeVersion.current += 1; setDirty(true); }}><SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger><SelectContent>{META_COPY_CTA_VALUES.map(value => <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></label></div></section>
            <section className="border-t border-border pt-4"><h2 className="text-sm font-semibold">AI copy assist</h2><textarea value={brief} onChange={event => setBrief(event.target.value)} rows={3} placeholder="What should this ad communicate?" className="mt-2 w-full resize-y rounded-(--r-ctl) border border-input bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /><Button type="button" variant="outline" size="sm" className="mt-2" disabled={proposalBusy} onClick={() => void propose()}><Sparkles className="size-3.5" />{proposalBusy ? "Drafting…" : "Generate proposal"}</Button>{proposal ? <div className="mt-3 rounded-(--r-ctl) border border-border bg-muted/50 p-3"><p className="text-xs font-semibold">Proposal from {proposal.source}</p><div className="mt-2 space-y-2 text-xs leading-5">{Object.entries(proposal.onImage).map(([key, value]) => <p key={key}><strong>{pack.textInputs.find(input => input.key === key)?.label ?? key}: </strong>{value}</p>)}{proposal.copy.primaryText ? <p>{proposal.copy.primaryText}</p> : null}{proposal.copy.headline ? <p className="font-semibold">{proposal.copy.headline}</p> : null}{proposal.copy.description ? <p>{proposal.copy.description}</p> : null}</div><p className="mt-2 text-xs text-muted-foreground">Nothing changes until you apply it.</p><Button type="button" size="sm" className="mt-3" onClick={() => { const nextCopy = { ...copy, ...proposal.copy }; applyValues(proposal.onImage, nextCopy); setProposal(null); }}>Apply proposal</Button></div> : null}</section>
            {assetRequest?.kind === "choose" ? <section className="border-t border-border pt-4"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Choose an image</h2><Button type="button" variant="ghost" size="sm" onClick={() => { send("asset-result", { requestId: assetRequest.requestId, cancelled: true }, assetRequest.requestId); setAssetRequest(null); }}>Cancel</Button></div><div className="mt-3 grid grid-cols-2 gap-2">{libraryAssets.map(asset => <Button type="button" variant="outline" key={asset.id} onClick={() => void completeAsset(asset)} className="h-auto flex-col items-stretch overflow-hidden p-0 text-left"><img src={asset.thumbnailUrl ?? asset.url} alt="" className="aspect-square w-full object-cover" /><span className="block truncate p-2 text-xs font-medium">{asset.name}</span></Button>)}</div></section> : null}
          </TabsContent>
          <TabsContent value="preview" className="p-4"><NativeMetaPreview placement={active} image={preview[active]} copy={copy} businessName={businessName} logoUrl={logoUrl} destinationUrl={initialDocument.destinationUrl} /></TabsContent>
        </Tabs>
      </SheetContent></Sheet>
    </div>
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); else if (assetRequest) { send("asset-result", { requestId: assetRequest.requestId, cancelled: true }, assetRequest.requestId); setAssetRequest(null); } event.currentTarget.value = ""; }} />
    {native.sourceAdId || sourceAdId ? <div className="shrink-0 border-t border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground">Editing a separate trial copy. <a className="font-medium text-foreground underline underline-offset-4" href={`/ad-studio/ads/${encodeURIComponent(native.sourceAdId ?? sourceAdId!)}`}>Open original ad</a></div> : null}
  </div>;
}

function CopyField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-xs font-medium">{label}<Input value={value} className="mt-1" onChange={event => onChange(event.target.value)} /></label>;
}
function templateMetaCopy(pack: AdTemplate, document?: AdDocumentParsed): NativeMetaCopy {
  return {
    primaryText: document?.metaPrimaryText || pack.metadata.metaCopyDefaults.primaryText[0] || "",
    headline: document?.metaHeadline || pack.metadata.metaCopyDefaults.headlines[0] || "",
    description: document?.metaDescription || pack.metadata.metaCopyDefaults.descriptions[0] || "",
    cta: document?.metaCta || pack.metadata.metaCopyDefaults.cta || "LEARN_MORE",
  };
}
