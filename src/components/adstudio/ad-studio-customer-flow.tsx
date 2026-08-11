"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ImageIcon, LoaderCircle, Megaphone, Pencil, Plus, Redo2, Send, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioCreative,
  AdStudioOfferTemplate,
  AdStudioTargetLocation,
  AdStudioTemplate,
  FirstAdInput,
} from "@/lib/adstudio";
import { builtInAdStudioTemplates } from "@/lib/adstudio";
import { primaryImageSource } from "@/lib/adstudio/creative-preview";
import { templateThumbnailSrcSet } from "@/lib/adstudio/template-display";
import { downscaleImageForUpload } from "@/lib/upload/asset-file";

import { requestCreativeEdit, requestCreativeLayers } from "./canvas/creative-edit-client";
import { loadPatchFonts, loadPatchImage, PATCH_PADDING, renderTextPatch } from "./canvas/text-patch";
import { initialOfferLabelForPack } from "./template-offer-state";
import { useCampaignActions, type GenerationProgress } from "./use-campaign-actions";
import { seedCopy } from "./use-copy";

type Stage = "create" | "edit" | "publish";
type Placement = "4:5" | "9:16";

type AdStudioCustomerFlowProps = {
  brandKit: AdStudioBrandKit;
  campaignPack: AdStudioCampaignPack;
  offers: AdStudioOfferTemplate[];
};

type CampaignSummary = { id: string; name: string; status: string; updated_at?: string | null };

const STAGES: Array<{ id: Stage; label: string; icon: typeof Plus }> = [
  { id: "create", label: "Create", icon: Plus },
  { id: "edit", label: "Edit", icon: Pencil },
  { id: "publish", label: "Publish", icon: Send },
];

function initialMarket(pack: AdStudioCampaignPack): string {
  return [pack.campaign.market.suburb, pack.campaign.market.state].filter(Boolean).join(", ") || "Perth, WA";
}

function initialDestination(pack: AdStudioCampaignPack, brandKit: AdStudioBrandKit): string {
  return pack.copyPacks[0]?.googleSearch.finalUrl || brandKit.source.url || "";
}

function stageForPack(pack: AdStudioCampaignPack): Stage {
  return hasFinishedPlacement(pack, "4:5") || hasFinishedPlacement(pack, "9:16") ? "edit" : "create";
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}

function templateCopy(template: AdStudioTemplate) {
  return {
    primaryText: template.meta.primaryText[0] ?? template.audienceIntent,
    headline: template.meta.headlines[0] ?? template.name,
    description: template.meta.descriptions[0] ?? "",
    cta: template.meta.cta,
  };
}

function creativeFor(pack: AdStudioCampaignPack, format: Placement): AdStudioCreative | null {
  return pack.creatives.find((creative) => creative.format === format) ?? null;
}

function creativeSource(creative: AdStudioCreative): string {
  const object = creative.canvas.objects.find((item) => item.objectId === "template_clone_image")
    ?? creative.canvas.objects.find((item) => item.role === "primary_image")
    ?? creative.canvas.objects[0];
  return object?.content?.trim() || object?.assetId?.trim() || "";
}

function hasFinishedPlacement(pack: AdStudioCampaignPack, format: Placement): boolean {
  const creative = creativeFor(pack, format);
  return Boolean(creative?.activeRevisionId && creativeSource(creative));
}

function optimisticPatchStyle(box: { x: number; y: number; width: number; height: number }): CSSProperties {
  const left = Math.max(0, box.x - PATCH_PADDING);
  const top = Math.max(0, box.y - PATCH_PADDING);
  const right = Math.min(1, box.x + box.width + PATCH_PADDING);
  const bottom = Math.min(1, box.y + box.height + PATCH_PADDING);
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${(right - left) * 100}%`,
    height: `${(bottom - top) * 100}%`,
  };
}

function CompactCreativeEditor({ creative, onCreativeChange, showToast }: {
  creative: AdStudioCreative;
  onCreativeChange: (creative: AdStudioCreative) => void;
  showToast: (message: string) => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedFontIds, setLoadedFontIds] = useState<Set<string>>(new Set());
  const [loadedPlate, setLoadedPlate] = useState<string | null>(null);
  const [layerBuildIssue, setLayerBuildIssue] = useState<string | null>(null);
  const [layerRetryToken, setLayerRetryToken] = useState(0);
  const [freshPreview, setFreshPreview] = useState<{ ref: string; dataUrl: string } | null>(null);
  const [optimisticPatch, setOptimisticPatch] = useState<{ dataUrl: string; box: { x: number; y: number; width: number; height: number } } | null>(null);
  const layersRequestedForRef = useRef<string | null>(null);
  const plateImagesRef = useRef(new Map<string, HTMLImageElement>());
  const creativeRef = useRef(creative);
  creativeRef.current = creative;
  const selected = creative.canvas.cloneQa?.regions.find((region) => region.key === selectedKey) ?? null;
  const src = creativeSource(creative);
  const displaySrc = freshPreview?.ref === src ? freshPreview.dataUrl : src;
  const regions = creative.canvas.cloneQa?.regions ?? [];
  const textLayers = creative.canvas.textLayers;
  const layersReady = textLayers?.status === "ready" && textLayers.validFor.includes(src);
  const selectedTextStyle = selected?.kind === "text" ? textLayers?.styles[selected.key] : undefined;
  const selectedTextInstantReady = Boolean(
    layersReady
    && loadedPlate === textLayers?.plate
    && selectedTextStyle?.mode === "live"
    && loadedFontIds.has(selectedTextStyle.fontId),
  );
  const canUndo = (creative.canvas.renderHistory?.length ?? 0) > 0;
  const canRedo = (creative.canvas.redoHistory?.length ?? 0) > 0;

  useEffect(() => {
    if (regions.length === 0 || busy || !src || src.startsWith("data:")) return;
    const current = creativeRef.current.canvas.textLayers;
    if (current?.status === "ready" && current.validFor.includes(src)) return;

    if (current?.status === "building" && current.derivedFrom === src) {
      let cancelled = false;
      let retry: number | undefined;
      const poll = () => {
        retry = window.setTimeout(() => {
          void requestCreativeLayers(creative.creativeId).then((built) => {
            if (cancelled) return;
            if (!built) {
              setLayerBuildIssue("Exact text editing could not finish preparing.");
              return;
            }
            if (built.status === "building") return poll();
            const latest = creativeRef.current;
            const latestSrc = creativeSource(latest);
            if (built.status === "ready" && !built.validFor.includes(latestSrc)) return;
            setLayerBuildIssue(built.status === "failed" ? built.error ?? "Exact text editing could not finish preparing." : null);
            onCreativeChange({ ...latest, canvas: { ...latest.canvas, textLayers: built } });
          });
        }, 2_000);
      };
      poll();
      return () => {
        cancelled = true;
        if (retry !== undefined) window.clearTimeout(retry);
      };
    }

    if (layersRequestedForRef.current === src) return;
    layersRequestedForRef.current = src;
    let cancelled = false;
    void requestCreativeLayers(creative.creativeId).then((built) => {
      if (cancelled) return;
      if (!built) {
        setLayerBuildIssue("Exact text editing could not finish preparing.");
        return;
      }
      const latest = creativeRef.current;
      const latestSrc = creativeSource(latest);
      if ((built.status === "ready" && !built.validFor.includes(latestSrc))
        || (built.status === "building" && built.derivedFrom !== latestSrc)) return;
      setLayerBuildIssue(built.status === "failed" ? built.error ?? "Exact text editing could not finish preparing." : null);
      onCreativeChange({ ...latest, canvas: { ...latest.canvas, textLayers: built } });
    });
    return () => { cancelled = true; };
  }, [busy, creative.creativeId, layerRetryToken, onCreativeChange, regions.length, src]);

  useEffect(() => {
    const plate = textLayers?.plate;
    if (!plate) {
      setLoadedPlate(null);
      return;
    }
    if (plateImagesRef.current.has(plate)) {
      setLoadedPlate(plate);
      return;
    }
    setLoadedPlate(null);
    let cancelled = false;
    void loadPatchImage(plate).then((image) => {
      if (cancelled) return;
      plateImagesRef.current.set(plate, image);
      setLoadedPlate(plate);
    }).catch(() => {
      if (!cancelled) setLayerBuildIssue("The exact-text editing plate could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [layerRetryToken, textLayers?.plate]);

  useEffect(() => {
    if (!textLayers) return;
    let cancelled = false;
    const styles = Object.values(textLayers.styles);
    void loadPatchFonts(styles).then((loaded) => {
      if (cancelled) return;
      setLoadedFontIds(loaded);
      const required = new Set(styles.filter((style) => style.mode === "live").map((style) => style.fontId));
      if ([...required].some((fontId) => !loaded.has(fontId))) {
        setLayerBuildIssue("The exact text font could not be loaded.");
      }
    });
    return () => { cancelled = true; };
  }, [layerRetryToken, textLayers]);

  function chooseRegion(key: string) {
    const region = creative.canvas.cloneQa?.regions.find((item) => item.key === key);
    setSelectedKey(key);
    setDraft(region?.kind === "text" ? creative.canvas.cloneQa?.copyValues[key] ?? "" : "");
  }

  async function mutate(mutation: { action?: "undo" | "redo" | "edit"; fieldKey?: string; newValue?: string; newImage?: string; instruction?: string }) {
    if (!creative.activeRevisionId) return showToast("Reload this ad before editing it.");
    setBusy(true);
    try {
      const result = await requestCreativeEdit({ creative, mutation, mutationId: crypto.randomUUID() });
      const nextRef = creativeSource(result.creative);
      setFreshPreview(result.previewImage && nextRef ? { ref: nextRef, dataUrl: result.previewImage } : null);
      onCreativeChange(result.creative);
      if (mutation.action === "undo") showToast("Previous version restored");
      else if (mutation.action === "redo") showToast("Next version restored");
      else showToast("New version saved");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The edit could not be saved.");
    } finally {
      setOptimisticPatch(null);
      setBusy(false);
    }
  }

  async function replaceRegionImage(file: File | null) {
    if (!file || !selected || selected.kind !== "image") return;
    const scaled = await downscaleImageForUpload(file);
    await mutate({ action: "edit", fieldKey: selected.key, newImage: await readFile(scaled), instruction: draft.trim() || undefined });
  }

  function saveTextChange() {
    if (!selected || selected.kind !== "text") return;
    const value = draft.trim();
    if (!value) return;
    const maxLength = selectedTextStyle?.maxLength ?? 200;
    if (value.length > maxLength) return showToast(`Keep the replacement text to ${maxLength} characters or less.`);
    if (!selectedTextInstantReady || !textLayers || !selectedTextStyle) {
      showToast(layerBuildIssue ?? "This text area is still preparing. Wait a moment, then try again.");
      return;
    }
    const plate = plateImagesRef.current.get(textLayers.plate);
    const patchImage = plate ? renderTextPatch({ plate, box: selected.box, style: selectedTextStyle, text: value }) : null;
    if (!patchImage) {
      showToast("That text does not fit this area. Shorten it and try again.");
      return;
    }
    setOptimisticPatch({ dataUrl: patchImage, box: selected.box });
    void mutate({ action: "edit", fieldKey: selected.key, newValue: value });
  }

  function retryLayerBuild() {
    layersRequestedForRef.current = null;
    setLayerBuildIssue(null);
    setLayerRetryToken((current) => current + 1);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <Badge variant="outline">Version {Math.max(1, (creative.canvas.renderHistory?.length ?? 0) + 1)}</Badge>
          <div className="flex gap-1">
            <Button size="icon" variant="outline" aria-label="Undo edit" disabled={!canUndo || busy} onClick={() => void mutate({ action: "undo" })}><Undo2 aria-hidden /></Button>
            <Button size="icon" variant="outline" aria-label="Redo edit" disabled={!canRedo || busy} onClick={() => void mutate({ action: "redo" })}><Redo2 aria-hidden /></Button>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-xl overflow-hidden rounded-(--r-card) bg-muted" style={{ aspectRatio: `${creative.canvas.width}/${creative.canvas.height}` }}>
          {displaySrc && <img src={displaySrc} alt="Finished ad" className="size-full object-contain" />}
          {optimisticPatch && <img src={optimisticPatch.dataUrl} alt="" aria-hidden className="absolute object-fill" style={optimisticPatchStyle(optimisticPatch.box)} />}
          {(creative.canvas.cloneQa?.regions ?? []).map((region) => (
            <button
              key={`${region.kind}-${region.key}`}
              type="button"
              aria-label={`Edit ${region.key.replaceAll("_", " ")}`}
              aria-pressed={selectedKey === region.key}
              className="absolute rounded-sm border-2 border-transparent bg-transparent transition hover:border-primary focus-visible:border-primary focus-visible:outline-none data-[selected=true]:border-primary data-[selected=true]:bg-primary/10"
              data-selected={selectedKey === region.key}
              style={{ left: `${region.box.x * 100}%`, top: `${region.box.y * 100}%`, width: `${region.box.width * 100}%`, height: `${region.box.height * 100}%` }}
              onClick={() => chooseRegion(region.key)}
            />
          ))}
          {busy && <div className="absolute inset-0 grid place-items-center bg-background/70"><LoaderCircle className="animate-spin" aria-label="Saving edit" /></div>}
        </div>
      </div>
      <aside className="grid content-start gap-3 rounded-(--r-card) border border-border bg-background p-4">
        {!selected ? (
          <><h3 className="m-0 text-base font-bold">Choose an area</h3><p className="m-0 text-sm leading-6 text-muted-foreground">Select outlined text or an image on the finished ad. Only that area will change.</p></>
        ) : (
          <>
            <div><Badge variant="secondary">{selected.kind === "text" ? "Text" : "Image"}</Badge><h3 className="mb-0 mt-2 text-base font-bold capitalize">{selected.key.replaceAll("_", " ")}</h3></div>
            <Label htmlFor="region-edit">{selected.kind === "text" ? "Replacement text" : "Image direction (optional)"}</Label>
            <Textarea id="region-edit" className="min-h-24" value={draft} maxLength={selected.kind === "text" ? 200 : 500} onChange={(event) => setDraft(event.target.value)} />
            {selected.kind === "text" ? (
              <>
                {!selectedTextInstantReady && !layerBuildIssue && <p className="m-0 text-sm text-muted-foreground" role="status">Preparing exact text editing…</p>}
                {layerBuildIssue && <div className="grid gap-2"><p className="m-0 text-sm text-destructive" role="alert">{layerBuildIssue}</p><Button variant="outline" onClick={retryLayerBuild}>Try preparing again</Button></div>}
                <Button disabled={!draft.trim() || busy || !selectedTextInstantReady} onClick={saveTextChange}>Save text change</Button>
              </>
            ) : (
              <>
                <Button variant="outline" disabled={busy} onClick={() => void mutate({ action: "edit", fieldKey: selected.key, instruction: draft.trim() })}>Apply image direction</Button>
                <Label className="flex cursor-pointer items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                  Replace image<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void replaceRegionImage(event.target.files?.[0] ?? null)} />
                </Label>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

type ServerPublishReadiness = {
  ready: boolean;
  blockers: string[];
};

type PlanPublishReadiness = {
  ready: boolean;
  blockers: Array<{ code: string; message: string }>;
  planToken: string;
  budget: { dailyMinorUnits: number; currency: string };
};

function CompactPublish({ campaignId, campaignPack, brandKit, destinationUrl, onChangeDestinationUrl, onChangeTargeting, onChangeLeadForm, brandApproved }: {
  campaignId: string;
  campaignPack: AdStudioCampaignPack;
  brandKit: AdStudioBrandKit;
  destinationUrl: string;
  onChangeDestinationUrl: (value: string) => void;
  onChangeTargeting: (locations: AdStudioTargetLocation[], surrounding: boolean) => void;
  onChangeLeadForm: (form: { headline: string; questions: string[]; thankYouScreen: { title: string; body: string } }) => void;
  brandApproved: boolean;
}) {
  const initialForm = campaignPack.copyPacks[0]?.meta.leadForm;
  const [headline, setHeadline] = useState(initialForm?.headline ?? "");
  const [questions, setQuestions] = useState<string[]>(
    (initialForm?.questions ?? []).filter((question) => question.trim().toLowerCase() !== "what is your best contact number?"),
  );
  const [thankYouTitle, setThankYouTitle] = useState(initialForm?.thankYouScreen.title ?? "Request received");
  const [thankYouBody, setThankYouBody] = useState(initialForm?.thankYouScreen.body ?? "We will be in touch shortly.");
  const [dailyBudget, setDailyBudget] = useState(20);
  const [locationQuery, setLocationQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AdStudioTargetLocation[]>([]);
  const [surrounding, setSurrounding] = useState(campaignPack.campaign.market.includeSurroundingSuburbs ?? true);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [published, setPublished] = useState(false);
  const [publishedPlanId, setPublishedPlanId] = useState("");
  const [activationConfirmed, setActivationConfirmed] = useState(false);
  const [activationRequested, setActivationRequested] = useState(false);
  const [activating, setActivating] = useState(false);
  const [serverReadiness, setServerReadiness] = useState<ServerPublishReadiness | null>(null);
  const [planReadiness, setPlanReadiness] = useState<PlanPublishReadiness | null>(null);
  const targetSuburbs = campaignPack.campaign.market.targetSuburbs ?? [];
  const privacyUrl = brandKit.compliance.privacyPolicyUrl ?? "";
  const normalizedQuestions = questions.map((question) => question.trim()).filter(Boolean);
  const uniqueQuestions = new Set(normalizedQuestions.map((question) => question.toLowerCase())).size === normalizedQuestions.length;
  const placementsReady = hasFinishedPlacement(campaignPack, "4:5") && hasFinishedPlacement(campaignPack, "9:16");
  const ready = serverReadiness?.ready === true && brandApproved && placementsReady && isHttpsUrl(destinationUrl) && isHttpsUrl(privacyUrl)
    && targetSuburbs.length > 0 && dailyBudget >= 1 && Boolean(headline.trim())
    && normalizedQuestions.length <= 5 && uniqueQuestions && Boolean(thankYouTitle.trim()) && Boolean(thankYouBody.trim());

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/adstudio/publish-readiness", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "Meta readiness could not be checked.");
        setServerReadiness({ ready: body.ready === true, blockers: Array.isArray(body.blockers) ? body.blockers : [] });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setServerReadiness({ ready: false, blockers: [error instanceof Error ? error.message : "Meta readiness could not be checked."] });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const query = locationQuery.trim();
    if (query.length < 2) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/adstudio/meta-targeting-locations?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() : null)
        .then((body) => setSuggestions(Array.isArray(body?.locations) ? body.locations : []))
        .catch(() => undefined);
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [locationQuery]);

  function syncForm(next: { headline?: string; questions?: string[]; thankYouTitle?: string; thankYouBody?: string }) {
    const values = { headline: next.headline ?? headline, questions: next.questions ?? questions, thankYouTitle: next.thankYouTitle ?? thankYouTitle, thankYouBody: next.thankYouBody ?? thankYouBody };
    setHeadline(values.headline); setQuestions(values.questions); setThankYouTitle(values.thankYouTitle); setThankYouBody(values.thankYouBody);
    onChangeLeadForm({ headline: values.headline, questions: values.questions, thankYouScreen: { title: values.thankYouTitle, body: values.thankYouBody } });
  }

  async function publish() {
    if (!ready) return;
    setPublishing(true); setPublishError(""); setPublished(false);
    const start = new Date(); const end = new Date(start); end.setDate(end.getDate() + 7);
    try {
      const response = await fetch(`/api/adstudio/export-packages/${campaignId}/publish`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadForm: {
            headline: headline.trim(),
            questions: normalizedQuestions,
            thankYouScreen: { title: thankYouTitle.trim(), body: thankYouBody.trim() },
          },
          dryRun: false,
          controls: {
            dailyBudgetMinorUnits: Math.round(dailyBudget * 100), destinationUrl,
            geo: { type: "cities", locations: targetSuburbs, includeSurroundingSuburbs: surrounding },
            schedule: { startTime: start.toISOString(), endTime: end.toISOString() },
            placements: { publisherPlatforms: ["facebook", "instagram"], facebookPositions: [], instagramPositions: [] },
          },
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Meta could not prepare the campaign.");
      if (body.providerWritesEnabled === false) throw new Error("Live Meta publishing is not enabled for this workspace.");
      const planId = typeof body.metaPublishPlan?.id === "string" ? body.metaPublishPlan.id : "";
      if (!(planId && (body.queueJobId || body.activePublishJob || ["publishing", "paused_ready"].includes(body.metaPublishPlan?.status)))) throw new Error(body.blockers?.join(" ") || "Meta did not confirm the publish request.");
      setPublishedPlanId(planId);
      if (body.metaPublishPlan?.status !== "paused_ready") await waitForPausedPlan(planId);
      await loadPlanReadiness(planId);
      setPublished(true);
    } catch (error) { setPublishError(error instanceof Error ? error.message : "Publishing failed."); }
    finally { setPublishing(false); }
  }

  async function waitForPausedPlan(planId: string) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      const response = await fetch(`/api/integrations/meta/publish-plans/${planId}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Meta publish status could not be checked.");
      if (body.status === "paused_ready") return;
      if (body.status === "failed") throw new Error(body.lastError ?? body.queueError ?? "Meta could not create the paused campaign.");
    }
    throw new Error("Meta is still preparing the paused campaign. Refresh this ad to check again.");
  }

  async function loadPlanReadiness(planId: string) {
    const response = await fetch(`/api/integrations/meta/publish-plans/${planId}/readiness`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Final Meta readiness could not be checked.");
    const next: PlanPublishReadiness = {
      ready: body.ready === true,
      blockers: Array.isArray(body.blockers) ? body.blockers : [],
      planToken: typeof body.planToken === "string" ? body.planToken : "",
      budget: {
        dailyMinorUnits: Number(body.budget?.dailyMinorUnits ?? 0),
        currency: typeof body.budget?.currency === "string" ? body.budget.currency : "",
      },
    };
    if (!next.ready || !next.planToken || !Number.isInteger(next.budget.dailyMinorUnits) || next.budget.dailyMinorUnits < 1 || !next.budget.currency) {
      throw new Error(next.blockers.map((blocker) => blocker.message).join(" ") || "The current Meta plan is not ready for activation.");
    }
    setPlanReadiness(next);
    setActivationConfirmed(false);
  }

  async function requestActivation() {
    if (!publishedPlanId || !activationConfirmed || !planReadiness?.ready || activating) return;
    setActivating(true); setPublishError("");
    try {
      const response = await fetch(`/api/integrations/meta/publish-plans/${publishedPlanId}/mutations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "activate",
          confirmSpend: true,
          dailyBudgetMinorUnits: planReadiness.budget.dailyMinorUnits,
          currency: planReadiness.budget.currency,
          planToken: planReadiness.planToken,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Activation could not be requested.");
      setActivationRequested(true);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Activation could not be requested.");
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-5">
        <Card className="shadow-none"><CardHeader><CardTitle className="text-base">Finished placements</CardTitle><CardDescription>These are the exact current Feed and Story renders that will be attached.</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-3">{(["4:5", "9:16"] as Placement[]).map((format) => { const creative = creativeFor(campaignPack, format); return <div key={format} className="grid gap-2"><Badge variant="outline" className="w-fit">{format === "4:5" ? "Feed" : "Story"}</Badge><div className="overflow-hidden rounded-(--r-card) bg-muted" style={{ aspectRatio: format === "4:5" ? "4/5" : "9/16" }}>{creative ? <img src={creativeSource(creative)} alt={`${format} finished ad`} className="size-full object-cover" /> : <div className="grid size-full place-items-center text-xs text-muted-foreground">Not generated</div>}</div></div>; })}</CardContent></Card>
        <Card className="shadow-none"><CardHeader><CardTitle className="text-base">Instant Form</CardTitle><CardDescription>Name, email and phone are collected by Meta. Add zero to five unique custom questions.</CardDescription></CardHeader><CardContent className="grid gap-4">
          <div className="grid gap-2"><Label htmlFor="form-headline">Form headline</Label><Input id="form-headline" value={headline} onChange={(event) => syncForm({ headline: event.target.value })} /></div>
          <div className="grid gap-2"><Label>Custom questions</Label>{questions.map((question, index) => <div className="flex gap-2" key={index}><Input aria-label={`Question ${index + 1}`} value={question} onChange={(event) => { const next = [...questions]; next[index] = event.target.value; syncForm({ questions: next }); }} /><Button size="icon" variant="ghost" aria-label={`Remove question ${index + 1}`} onClick={() => syncForm({ questions: questions.filter((_, item) => item !== index) })}><Trash2 aria-hidden /></Button></div>)}{questions.length < 5 && <Button variant="outline" className="w-fit" onClick={() => syncForm({ questions: [...questions, ""] })}><Plus aria-hidden /> Add question</Button>}{!uniqueQuestions && <p className="m-0 text-sm text-destructive">Each question must be unique.</p>}</div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="thanks-title">Thank-you title</Label><Input id="thanks-title" value={thankYouTitle} onChange={(event) => syncForm({ thankYouTitle: event.target.value })} /></div><div className="grid gap-2"><Label htmlFor="thanks-body">Thank-you message</Label><Input id="thanks-body" value={thankYouBody} onChange={(event) => syncForm({ thankYouBody: event.target.value })} /></div></div>
          <div className="grid gap-2"><Label>Privacy policy</Label><p className="m-0 break-all rounded-md bg-muted px-3 py-2 text-sm">{privacyUrl || "Add a privacy policy URL in your Brand Pack before publishing."}</p></div>
        </CardContent></Card>
      </div>
      <aside className="grid content-start gap-4">
        <Card className="shadow-none"><CardHeader><CardTitle className="text-base">Audience & budget</CardTitle></CardHeader><CardContent className="grid gap-4">
          <div className="grid gap-2"><Label htmlFor="location">Target suburb</Label><Input id="location" value={locationQuery} placeholder="Start typing a suburb" onChange={(event) => setLocationQuery(event.target.value)} />{suggestions.length > 0 && <div className="grid rounded-md border border-border p-1">{suggestions.slice(0, 5).map((location) => <Button key={location.key} variant="ghost" className="justify-start" onClick={() => { onChangeTargeting([...targetSuburbs.filter((item) => item.key !== location.key), location], surrounding); setLocationQuery(""); setSuggestions([]); }}>{location.name}{location.region ? `, ${location.region}` : ""}</Button>)}</div>}</div>
          {targetSuburbs.map((location) => <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm" key={location.key}><span>{location.name}{location.region ? `, ${location.region}` : ""}</span><Button size="icon" variant="ghost" aria-label={`Remove ${location.name}`} onClick={() => onChangeTargeting(targetSuburbs.filter((item) => item.key !== location.key), surrounding)}><Trash2 aria-hidden /></Button></div>)}
          <label className="flex items-center gap-3 text-sm"><Checkbox checked={surrounding} onCheckedChange={(checked) => { const value = checked === true; setSurrounding(value); onChangeTargeting(targetSuburbs, value); }} /> Include surrounding suburbs</label>
          <div className="grid gap-2"><Label htmlFor="destination">Thank-you website URL</Label><Input id="destination" type="url" value={destinationUrl} onChange={(event) => onChangeDestinationUrl(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="budget">Daily budget (AUD)</Label><Input id="budget" type="number" min={1} value={dailyBudget} onChange={(event) => setDailyBudget(Number(event.target.value))} /></div>
        </CardContent></Card>
        <Card className="shadow-none"><CardHeader><CardTitle className="text-base">Safe launch</CardTitle><CardDescription>Submission creates the campaign, ad set, ads and Instant Form in PAUSED state. It does not start spend.</CardDescription></CardHeader><CardContent className="grid gap-3">
          {publishError && <p className="m-0 text-sm text-destructive" role="alert">{publishError}</p>}
          {serverReadiness && !serverReadiness.ready && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"><p className="m-0 font-semibold">Meta is not ready</p>{serverReadiness.blockers.map((blocker) => <p className="mb-0 mt-1" key={blocker}>{blocker}</p>)}</div>}
          {published && <p className="m-0 rounded-md bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">Your Meta campaign is ready and paused. No spend has started.</p>}
          {!published && <Button size="lg" disabled={!ready || publishing} onClick={() => void publish()}>{publishing ? <LoaderCircle className="animate-spin" /> : <Send aria-hidden />}{publishing ? "Creating paused campaign…" : "Create paused Meta campaign"}</Button>}
          {published && planReadiness && !activationRequested && <><label className="flex items-start gap-3 text-sm"><Checkbox checked={activationConfirmed} onCheckedChange={(checked) => setActivationConfirmed(checked === true)} /><span>I confirm activation can spend up to <strong>{new Intl.NumberFormat("en-AU", { style: "currency", currency: planReadiness.budget.currency }).format(planReadiness.budget.dailyMinorUnits / 100)} {planReadiness.budget.currency} per day</strong> for the verified schedule.</span></label><Button size="lg" variant="outline" disabled={!activationConfirmed || activating} onClick={() => void requestActivation()}>{activating && <LoaderCircle className="animate-spin" />}{activating ? "Requesting activation…" : "Request activation"}</Button></>}
          {activationRequested && <p className="m-0 rounded-md bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">Activation queued. Blockwise will confirm when the campaign is active.</p>}
          {!ready && <p className="m-0 text-xs leading-5 text-muted-foreground">Complete Meta connection setup, Brand Pack approval, both active finished placements, HTTPS privacy and thank-you URLs, audience, form and budget.</p>}
        </CardContent></Card>
      </aside>
    </div>
  );
}

export function AdStudioCustomerFlow({ brandKit, campaignPack, offers }: AdStudioCustomerFlowProps) {
  const templates = useMemo(() => builtInAdStudioTemplates(), []);
  const [pack, setPack] = useState(campaignPack);
  const [stage, setStage] = useState<Stage>(() => stageForPack(campaignPack));
  const [placement, setPlacement] = useState<Placement>("4:5");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<AdStudioTemplate | null>(null);
  const [imageValues, setImageValues] = useState<Record<string, string>>({});
  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [generation, setGeneration] = useState<GenerationProgress | null>(null);
  const [createError, setCreateError] = useState("");
  const [toast, setToast] = useState("");
  const [recentCampaigns, setRecentCampaigns] = useState<CampaignSummary[]>([]);
  const [copy, setCopy] = useState(() => seedCopy(campaignPack));
  const [primaryImage, setPrimaryImage] = useState(() => primaryImageSource(campaignPack.creatives[0]) ?? "");
  const [offerLabel, setOfferLabel] = useState(() => initialOfferLabelForPack(campaignPack, offers));
  const [market] = useState(() => initialMarket(campaignPack));
  const [destinationUrl, setDestinationUrl] = useState(() => initialDestination(campaignPack, brandKit));
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? "" : current), 4000);
  }, []);

  const { generateFirstAd } = useCampaignActions({
    pack,
    brandKit,
    offers,
    market,
    copy,
    primaryImage,
    offerLabel,
    campaignGoal: pack.campaign.goal,
    destinationUrl,
    selectedVariantIndex,
    setPack,
    setSelectedVariantIndex,
    setCopy,
    setPrimaryImage,
    setOfferLabel,
    setSaveState,
    setSaveError: (message) => message && showToast(message),
    setBusy,
    setBusyMessage,
    setGeneration,
    setSection: (next) => setStage(next === "publish" ? "publish" : next === "edit" ? "edit" : "create"),
    showToast,
  });

  useEffect(() => {
    let active = true;
    void fetch("/api/adstudio/campaigns?limit=8", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        if (active && Array.isArray(body?.campaigns)) setRecentCampaigns(body.campaigns);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [pack.campaign.campaignId]);

  const currentCreative = creativeFor(pack, placement);
  const canEdit = hasFinishedPlacement(pack, "4:5") || hasFinishedPlacement(pack, "9:16");
  const brandApproved = brandKit.reviewStatus === "approved";

  function chooseTemplate(template: AdStudioTemplate) {
    setSelectedTemplate(template);
    setTextValues(Object.fromEntries(template.inputs.text.map((field) => [field.key, field.sample])));
    const logo = brandKit.logos.primaryLogoUrl ?? brandKit.logos.darkLogoUrl ?? brandKit.logos.lightLogoUrl;
    setImageValues(Object.fromEntries(template.inputs.images.flatMap((field) => /logo/i.test(field.key) && logo ? [[field.key, logo]] : [])));
    setCreateError("");
  }

  function closeCreate() {
    if (generation) return;
    setCreateOpen(false);
    setSelectedTemplate(null);
    setCreateError("");
  }

  async function setImage(fieldKey: string, file: File | null) {
    if (!file) return;
    try {
      const scaled = await downscaleImageForUpload(file);
      const value = await readFile(scaled);
      setImageValues((current) => ({ ...current, [fieldKey]: value }));
      setCreateError("");
    } catch {
      setCreateError("That image could not be prepared. Choose a JPG, PNG or WebP file.");
    }
  }

  async function createAd() {
    if (!selectedTemplate) return;
    const missingImage = selectedTemplate.inputs.images.find((field) => field.required && !imageValues[field.key]);
    const missingText = selectedTemplate.inputs.text.find((field) => field.required && !textValues[field.key]?.trim());
    if (missingImage || missingText) {
      setCreateError(`Add ${missingImage?.label ?? missingText?.label} before generating.`);
      return;
    }
    const primarySlot = selectedTemplate.inputs.images.find((field) => field.required) ?? selectedTemplate.inputs.images[0];
    const imageDataUrl = primarySlot ? imageValues[primarySlot.key] : "";
    const copyDefaults = templateCopy(selectedTemplate);
    const input: FirstAdInput = {
      source: "gallery",
      templateId: selectedTemplate.id,
      description: Object.values(textValues).filter(Boolean).join(" · ").slice(0, 500) || selectedTemplate.name,
      imageDataUrl,
      imageDataUrls: imageValues,
      onImageCopy: textValues,
      copy: copyDefaults,
      formats: ["9:16", "4:5"],
    };
    setCreateError("");
    try {
      await generateFirstAd(input);
      setCreateOpen(false);
      setSelectedTemplate(null);
      setStage("edit");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "The ad could not be generated.");
    }
  }

  const updateCreative = useCallback((creative: AdStudioCreative) => {
    setPack((current) => ({
      ...current,
      creatives: current.creatives.map((item) => item.creativeId === creative.creativeId ? creative : item),
    }));
    setPrimaryImage(primaryImageSource(creative) ?? "");
    setSaveState("saved");
  }, []);

  function updateTargeting(locations: AdStudioTargetLocation[], includeSurroundingSuburbs: boolean | undefined) {
    setPack((current) => ({
      ...current,
      campaign: { ...current.campaign, market: { ...current.campaign.market, targetSuburbs: locations, includeSurroundingSuburbs } },
    }));
  }

  function updateLeadForm(leadForm: { headline: string; questions: string[]; thankYouScreen: { title: string; body: string } }) {
    setPack((current) => ({
      ...current,
      copyPacks: current.copyPacks.map((item) => ({ ...item, meta: { ...item.meta, leadForm: { ...item.meta.leadForm, ...leadForm } } })),
    }));
  }

  return (
    <main className="tw min-h-dvh bg-(--surface-subtle) text-foreground" aria-label="Ad Studio">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Button asChild variant="ghost" size="icon" aria-label="Back to Blockwise">
            <Link href="/self-serve"><ArrowLeft aria-hidden /></Link>
          </Button>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Ad Studio</p>
            <p className="m-0 truncate text-sm font-bold">{pack.campaign.name || "Create a Meta ad"}</p>
          </div>
          {!brandApproved && <Badge variant="secondary">Brand needs review</Badge>}
          <Button onClick={() => setCreateOpen(true)}><Plus aria-hidden /> Create ad</Button>
        </div>
      </header>

      <nav className="sticky top-16 z-20 border-b border-border bg-background" aria-label="Ad Studio steps">
        <div className="mx-auto grid max-w-xl grid-cols-3 gap-1 p-2">
          {STAGES.map((item) => {
            const Icon = item.icon;
            const disabled = item.id !== "create" && !canEdit;
            return <Button key={item.id} variant={stage === item.id ? "secondary" : "ghost"} disabled={disabled} onClick={() => setStage(item.id)}>
              <Icon aria-hidden /> {item.label}
            </Button>;
          })}
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {stage === "create" && (
          <div className="grid gap-6">
            <section className="rounded-(--r-card) bg-foreground px-5 py-7 text-background sm:px-8 sm:py-10">
              <div className="max-w-2xl">
                <Badge variant="secondary" className="mb-4">12 quality-checked designs</Badge>
                <h1 className="m-0 text-3xl font-bold tracking-tight sm:text-4xl">Create a finished Meta ad</h1>
                <p className="mb-0 mt-3 max-w-xl text-sm leading-6 text-background/75 sm:text-base">
                  Choose a proven design, add only the photos and words it asks for, then Blockwise builds the finished Feed and Story ads.
                </p>
                <Button size="lg" variant="secondary" className="mt-6" onClick={() => setCreateOpen(true)}>
                  Choose a design <ArrowRight aria-hidden />
                </Button>
              </div>
            </section>

            {recentCampaigns.length > 0 && (
              <section aria-labelledby="recent-ads-title">
                <div className="mb-3 flex items-center justify-between">
                  <h2 id="recent-ads-title" className="m-0 text-lg font-bold">Your recent ads</h2>
                  <Badge variant="outline">Drafts</Badge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {recentCampaigns.slice(0, 6).map((campaign) => (
                    <Card key={campaign.id} className="shadow-none">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <CardTitle className="line-clamp-2 text-base">{campaign.name}</CardTitle>
                          <Badge variant="outline">{campaign.status || "draft"}</Badge>
                        </div>
                      </CardHeader>
                      <CardContent><Button asChild variant="outline" className="w-full"><Link href={`/ad-studio?campaignId=${campaign.id}`}>Open ad</Link></Button></CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {stage === "edit" && (
          <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="m-0 text-2xl font-bold tracking-tight">Edit finished ad</h1>
                  <p className="mb-0 mt-1 text-sm text-muted-foreground">Choose one area. Every change creates a new saved version.</p>
                </div>
                <Tabs value={placement} onValueChange={(value) => setPlacement(value as Placement)}>
                  <TabsList><TabsTrigger value="4:5">Feed</TabsTrigger><TabsTrigger value="9:16">Story</TabsTrigger></TabsList>
                </Tabs>
              </div>
              <Card className="overflow-hidden shadow-none">
                <CardContent className="p-3 sm:p-5">
                  {currentCreative ? (
                    <CompactCreativeEditor creative={currentCreative} onCreativeChange={updateCreative} showToast={showToast} />
                  ) : (
                    <div className="grid min-h-80 place-items-center text-center">
                      <div><ImageIcon className="mx-auto mb-3 text-muted-foreground" /><p className="font-semibold">{placement === "9:16" ? "Story is still rendering" : "No finished ad yet"}</p></div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            <aside className="grid content-start gap-4">
              <Card className="shadow-none">
                <CardHeader><CardTitle className="text-base">Ready when you are</CardTitle><CardDescription>Undo and redo are inside the editor. Publish always uses the current saved version.</CardDescription></CardHeader>
                <CardContent className="grid gap-2">
                  <Button onClick={() => setStage("publish")} disabled={!hasFinishedPlacement(pack, placement)}><Send aria-hidden /> Review & publish</Button>
                  <Button variant="outline" onClick={() => setCreateOpen(true)}><Plus aria-hidden /> Create another</Button>
                </CardContent>
              </Card>
              <Card className="shadow-none"><CardContent className="flex items-center gap-3 pt-5"><Check className="text-primary" /><p className="m-0 text-sm">{saveState === "saved" ? "Current version saved" : saveState === "saving" ? "Saving current version…" : "Save needs attention"}</p></CardContent></Card>
            </aside>
          </section>
        )}

        {stage === "publish" && (
          <section>
            <div className="mb-5">
              <h1 className="m-0 text-2xl font-bold tracking-tight">Publish to Meta</h1>
              <p className="mb-0 mt-1 text-sm text-muted-foreground">Review the current Feed and Story, your Instant Form, audience, budget and schedule. Submission creates paused Meta objects.</p>
            </div>
            <CompactPublish
              campaignId={pack.campaign.campaignId}
              campaignPack={pack}
              brandKit={brandKit}
              destinationUrl={destinationUrl}
              onChangeDestinationUrl={setDestinationUrl}
              onChangeTargeting={updateTargeting}
              onChangeLeadForm={updateLeadForm}
              brandApproved={brandApproved}
            />
          </section>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={(open) => open ? setCreateOpen(true) : closeCreate()}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{selectedTemplate ? "Make this design yours" : "Choose a design"}</DialogTitle>
            <DialogDescription>{selectedTemplate ? "Add exactly the images and words this design needs." : "Every design below passed clone, quality and edit-readiness checks."}</DialogDescription>
          </DialogHeader>

          {!selectedTemplate ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((template) => (
                <button key={template.id} type="button" className="group overflow-hidden rounded-(--r-card) border border-border bg-card text-left transition hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => chooseTemplate(template)}>
                  <span className="block aspect-[4/5] overflow-hidden bg-muted">
                    <img src={template.sample.imageSrc} srcSet={templateThumbnailSrcSet(template)} sizes="(max-width: 640px) 90vw, 300px" alt={template.sample.alt} className="size-full object-cover transition duration-300 group-hover:scale-[1.02]" />
                  </span>
                  <span className="block p-3"><strong className="block line-clamp-2 text-sm">{template.name}</strong><small className="mt-1 block text-muted-foreground">{template.format === "4:5" ? "Feed" : "Story"} · {template.inputs.images.length} image{template.inputs.images.length === 1 ? "" : "s"}</small></span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
              <div>
                <img src={selectedTemplate.sample.imageSrc} alt={selectedTemplate.sample.alt} className="aspect-[4/5] w-full rounded-(--r-card) border border-border object-cover" />
                <Button variant="ghost" className="mt-2 w-full" onClick={() => setSelectedTemplate(null)} disabled={Boolean(generation)}><ArrowLeft aria-hidden /> Choose another</Button>
              </div>
              <div className="grid content-start gap-5">
                <div><h3 className="m-0 text-lg font-bold">{selectedTemplate.name}</h3><p className="mb-0 mt-1 text-sm text-muted-foreground">Required fields are marked. Optional fields may keep the sample wording.</p></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {selectedTemplate.inputs.images.map((field) => (
                    <div className="grid gap-2" key={field.key}>
                      <Label htmlFor={`image-${field.key}`}>{field.label}{field.required ? " *" : ""}</Label>
                      <label htmlFor={`image-${field.key}`} className="flex min-h-24 cursor-pointer items-center gap-3 rounded-(--r-card) border border-dashed border-border bg-muted/35 p-3 text-sm hover:bg-muted">
                        <ImageIcon className="shrink-0 text-muted-foreground" />
                        <span>{imageValues[field.key] ? "Image ready — choose a different file" : field.description}</span>
                      </label>
                      <input id={`image-${field.key}`} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void setImage(field.key, event.target.files?.[0] ?? null)} />
                    </div>
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {selectedTemplate.inputs.text.map((field) => (
                    <div className="grid gap-2" key={field.key}>
                      <div className="flex items-center justify-between gap-2"><Label htmlFor={`text-${field.key}`}>{field.label}{field.required ? " *" : ""}</Label><span className="text-xs text-muted-foreground">{textValues[field.key]?.length ?? 0}/{field.maxLength}</span></div>
                      <Input id={`text-${field.key}`} value={textValues[field.key] ?? ""} maxLength={field.maxLength} onChange={(event) => setTextValues((current) => ({ ...current, [field.key]: event.target.value }))} />
                    </div>
                  ))}
                </div>
                {createError && <p className="m-0 rounded-(--r-card) bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{createError}</p>}
                {generation && <div className="flex items-center gap-3 rounded-(--r-card) bg-muted p-3 text-sm"><LoaderCircle className="animate-spin" /><span>{generation.phase}</span></div>}
                <Button size="lg" onClick={() => void createAd()} disabled={Boolean(generation)}>{generation ? <LoaderCircle className="animate-spin" aria-hidden /> : <Megaphone aria-hidden />}{generation ? "Building your ad…" : "Generate finished ad"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {(busy || toast) && <div className="fixed bottom-20 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background shadow-lg sm:bottom-6" role="status">{busy && <LoaderCircle className="size-4 animate-spin" />}{busy ? busyMessage : toast}</div>}
    </main>
  );
}
