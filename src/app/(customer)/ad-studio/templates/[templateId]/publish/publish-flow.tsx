"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Loader2, CircleAlert } from "lucide-react";
import { InstantFormEditor } from "@/components/adstudio/instant-form-editor";
import type { InstantForm } from "@/lib/adstudio/instant-form-types";
import type { PublishRequirements } from "@/lib/adstudio/publish-adapter";
import type { MetaParentState } from "@/lib/providers/meta-execution";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildExplicitMetaPublishControls, type PublishAudienceLocation, type PublishBudgetMode, type PublishFulfilmentDraft, type PublishSetupSummary, type PublishTargetMode, type PlacementChoice, type ScheduleStartIntent, type ScheduleEndIntent } from "./publish-controls";
export interface PublishFlowProps {
  adId: string;
  workspaceId: string;
  templateId: string;
  templateName: string;
  publishRequirements: PublishRequirements;
  /** True when the ad has no saved revision yet. */
  notSaved: boolean;
  initialState: {
    ad: { metaPrimaryText: string; metaHeadline: string; metaDescription: string; metaCta: string; destinationUrl: string };
    revision: { id: string; revisionNumber: number; documentHash: string; feedPngHash: string; feedPngPath: string; storyPngHash: string; storyPngPath: string; createdAt?: string };
    form: {
      name: string;
      formType: string;
      intro: { headline: string };
      contactFields: Array<{ type: string; required: boolean }>;
    } | null;
    formRevision: number | null;
  } | null;
  initialIssues: string[];
  providerWritesEnabled: boolean;
  audienceLocations: PublishAudienceLocation[];
  /** Optional last-checked Meta state for display only; publish re-verifies it server-side. */
  parentState?: MetaParentState;
  publishingDefaults?: { country: string; currency: string; leadDestination: string };
  canRequestManualPublish: boolean;
  automatedPublishAvailable: boolean;
  metaConnectionConnected: boolean;
}

type PublishReceipt = {
  deliveryStatus?: string;
  metaStatus?: { campaign: string; adSets: string; ads: string };
  activationRequested?: boolean;
  ok?: boolean;
  mode?: "dry_run" | "publish";
  providerWritesEnabled?: boolean;
  snapshotId?: string;
  source?: {
    snapshotId: string;
    creativeRevision: number | null;
    documentHash: string | null;
    feedPngHash: string | null;
    storyPngHash: string | null;
    formDraftId: string | null;
    formRevision: number | null;
  } | null;
  publishedCreative?: {
    feedPngPath: string | null;
    storyPngPath: string | null;
    primaryText: string;
    headline: string;
    description: string;
    cta: string;
  } | null;
  planId?: string;
  /** "active" confirms activation, not Meta delivery. */
  status?: "publishing" | "paused" | "unknown" | "active" | string;
  controlsFingerprint?: string;
  lastCheckedAt?: string;
  setupSummary?: PublishSetupSummary;
  activationError?: string;
  plannedObjects?: { campaigns: number; adSets: number; leadForms: number; creatives: number; ads: number };
  reconciledObjects?: {
    campaignId?: string;
    leadFormIds?: Record<string, string>;
    adSetIds?: Record<string, string>;
    creativeIds?: Record<string, string>;
    adIds?: Record<string, string>;
  };
  message?: string;
  error?: string;
  issues?: string[];
  blockers?: string[];
  unconfirmedPauseIds?: string[];
};


type ExistingOption = { id: string; name: string; budgetMode?: "campaign" | "adset"; eligible?: boolean; reason?: string; campaignId?: string };
type SetupOptions = { campaigns: ExistingOption[]; adSets: ExistingOption[]; error?: string };
const emptyFulfilment: PublishFulfilmentDraft = {
  exactOffer: "", eligibility: "", conditions: "", timeframe: "", evidence: "", approval: "",
  disclaimer: "", privacyUrl: "", consent: "", fulfilmentUrl: "", owner: "", expiry: "", tracking: "",
};
const placementOptions: Array<[PlacementChoice, string]> = [
  ["facebook_feed", "Facebook Feed"], ["instagram_feed", "Instagram Feed"],
  ["facebook_story", "Facebook Stories"], ["instagram_story", "Instagram Stories"],
];
const steps = ["Lead capture", "Audience & budget", "Review"] as const;
function inFourteenDays() { const date = new Date(Date.now() + 14 * 86400000); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); }

export function PublishFlow({
  adId, workspaceId, templateId, templateName, publishRequirements, notSaved, initialState,
  initialIssues, providerWritesEnabled, audienceLocations, parentState,
  canRequestManualPublish, automatedPublishAvailable, metaConnectionConnected, publishingDefaults,
}: PublishFlowProps) {
  const [stage, setStage] = useState(0);
  const [format, setFormat] = useState<"feed" | "story">("feed");
  const [form, setForm] = useState(initialState?.form ?? null);
  const [formPinned, setFormPinned] = useState(Boolean(initialState?.form));
  const [formRevision, setFormRevision] = useState(initialState?.formRevision ?? null);
  const [destinationUrl, setDestinationUrl] = useState(initialState?.ad.destinationUrl ?? "");
  const [targetMode, setTargetMode] = useState<PublishTargetMode>("new_campaign_new_adset");
  const [campaignId, setCampaignId] = useState("");
  const [adSetId, setAdSetId] = useState("");
  const [budgetMode, setBudgetMode] = useState<PublishBudgetMode>("campaign");
  const [dailyBudgetDollars, setDailyBudgetDollars] = useState("20");
  const [country, setCountry] = useState(publishingDefaults?.country ?? "");
  const [locations, setLocations] = useState(audienceLocations);
  const [selectedLocationKeys, setSelectedLocationKeys] = useState<string[]>([]);
  const [includeNearby, setIncludeNearby] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [placementsMode, setPlacementsMode] = useState<"automatic" | "manual">("automatic");
  const [placementChoices, setPlacementChoices] = useState<PlacementChoice[]>(placementOptions.map(([value]) => value));
  const [variants, setVariants] = useState<Array<"feed" | "story">>(["feed", "story"]);
  const [startIntent, setStartIntent] = useState<ScheduleStartIntent>("as_soon_as_activated");
  const [startAt, setStartAt] = useState("");
  const [endIntent, setEndIntent] = useState<ScheduleEndIntent>("scheduled");
  const [endAt, setEndAt] = useState(inFourteenDays);
  const [offerEnabled, setOfferEnabled] = useState(publishRequirements.fulfilmentRequired);
  const [fulfilment, setFulfilment] = useState(emptyFulfilment);
  const [advanced, setAdvanced] = useState(false);
  const [options, setOptions] = useState<SetupOptions>({ campaigns: [], adSets: [] });
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(true);
  const [refreshError, setRefreshError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [manualNotes, setManualNotes] = useState("");
  const [manualStatus, setManualStatus] = useState("");
  const [manualError, setManualError] = useState("");
  const [manualMutationId] = useState(() => crypto.randomUUID());
  const requestVersion = useRef(0);
  const stageRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [checkedParent, setCheckedParent] = useState<MetaParentState | undefined>(parentState);
  const selectedCampaign = options.campaigns.find(item => item.id === campaignId);
  const selectedAdSet = options.adSets.find(item => item.id === adSetId);
  const requiresForm = publishRequirements.destinationMode === "instant_form";
  const effectiveParent = checkedParent?.campaign?.id === campaignId ? checkedParent : undefined;
  const draft = {
    destinationMode: publishRequirements.destinationMode, destinationUrl, targetMode, campaignId,
    adSetIds: adSetId ? [adSetId] : [], variantIds: variants, budgetMode, dailyBudgetDollars,
    newCampaignObjective: publishRequirements.objective, newCampaignSpecialAdCategory: publishRequirements.specialAdCategory,
    newCampaignSpecialAdCategoryCountry: country, parentState: effectiveParent,
    audienceMode: "saved_locations" as const, availableLocations: locations, selectedLocationKeys,
    includeSurroundingSuburbs: includeNearby, latitude: "", longitude: "", radiusKm: "",
    placementsMode, placementChoices, startIntent, startAt, endIntent, endAt, offerEnabled,
    fulfilmentRequired: publishRequirements.fulfilmentRequired, fulfilment,
    reviewedCreativeRevision: initialState?.revision.revisionNumber ?? null,
    reviewedFormRevision: formPinned ? formRevision : null,
  };
  // Validation is not approval. Only the final button sends this exact setup.
  const build = buildExplicitMetaPublishControls({ ...draft, setupConfirmed: true });
  const formReady = !requiresForm || formPinned;
  const captureReady = formReady && validHttpsUrl(destinationUrl) && (!offerEnabled || Object.values(fulfilment).every(value => value.trim()));
  const currency = publishingDefaults?.currency || "";
  const ready = Boolean(currency) && (targetMode === "new_campaign_new_adset" || Boolean(effectiveParent?.campaign) && (targetMode !== "existing_adset" || Boolean(effectiveParent?.adSets?.some(item => item.id === adSetId)))) && !notSaved && initialIssues.length === 0 && captureReady && Boolean(build.controls);
  const existingBudget = targetMode === "existing_adset" || (targetMode === "existing_campaign_new_adset" && selectedCampaign?.budgetMode === "campaign");
  const dailyAmount = currency ? new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(Number(dailyBudgetDollars) || 0) : "Currency not configured";
  const spendLabel = existingBudget ? "Uses existing budget. No budget increase." : dailyAmount + " average daily budget";
  const persistedSummary = receipt?.setupSummary;
  const creationLocked = receipt?.mode === "publish" && Boolean(receipt.planId);
  const pending = submitting || (receipt?.mode === "publish" && ["publishing", "activating"].includes(receipt.status ?? ""));
  const outcome = publishOutcome(receipt);
  const performanceUrl = "/results?planId=" + encodeURIComponent(receipt?.planId ?? "");
  const previewPath = format === "feed" ? initialState?.revision.feedPngPath : initialState?.revision.storyPngPath;

  const onPinStateChange = useCallback((state: { pinned: boolean; revision: number | null; form: InstantForm | null }) => {
    setFormPinned(state.pinned); setFormRevision(state.revision); setForm(state.form);
  }, []);
  const refreshReceipt = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const response = await fetch("/api/adstudio/ads/" + encodeURIComponent(adId) + "/publish?workspaceId=" + encodeURIComponent(workspaceId), { cache: "no-store" });
      if (!response.ok) throw new Error("Publish status could not be refreshed. Try again.");
      const saved = await response.json() as PublishReceipt;
      if (version === requestVersion.current) { if (saved.mode) setReceipt(saved); setRefreshError(""); }
    } catch (error) {
      if (version === requestVersion.current) setRefreshError(error instanceof Error ? error.message : "Status unavailable. Try again.");
    } finally { if (version === requestVersion.current) setReceiptLoading(false); }
  }, [adId, workspaceId]);
  useEffect(() => { void refreshReceipt(); return () => { requestVersion.current += 1; }; }, [refreshReceipt]);
  useEffect(() => {
    if (!pending || submitting) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refreshReceipt(); if (!stopped) timer = setTimeout(poll, 3000); };
    timer = setTimeout(poll, 3000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [pending, submitting, refreshReceipt]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); stageRef.current?.focus({ preventScroll: true }); }, [stage]);
  useEffect(() => {
    if (automatedPublishAvailable) return;
    let current = true;
    void fetch("/api/adstudio/ads/" + encodeURIComponent(adId) + "/manual-publish?workspaceId=" + encodeURIComponent(workspaceId), { cache: "no-store" })
      .then(async response => response.ok ? response.json() : null)
      .then(body => { if (current && body?.request?.status) setManualStatus(body.request.status); }).catch(() => undefined);
    return () => { current = false; };
  }, [adId, workspaceId, automatedPublishAvailable]);

  const loadOptions = useCallback(async () => {
    setOptionsBusy(true);
    try {
      const response = await fetch("/api/adstudio/publish-options?workspaceId=" + encodeURIComponent(workspaceId), { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error || "Existing setups could not be loaded.");
      setOptions({ campaigns: body.campaigns ?? [], adSets: body.adSets ?? [] });
    } catch (error) { setOptions({ campaigns: [], adSets: [], error: error instanceof Error ? error.message : "Existing setups unavailable." }); }
    finally { setOptionsBusy(false); }
  }, [workspaceId]);
  useEffect(() => { if (advanced && metaConnectionConnected) void loadOptions(); }, [advanced, metaConnectionConnected, loadOptions]);
  useEffect(() => {
    setCheckedParent(undefined);
    if (!campaignId) return;
    let current = true;
    void fetch("/api/adstudio/publish-options?workspaceId=" + encodeURIComponent(workspaceId) + "&campaignId=" + encodeURIComponent(campaignId) + (adSetId ? "&adSetId=" + encodeURIComponent(adSetId) : ""), { cache: "no-store" })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; })
      .then(body => { if (current) setCheckedParent(body.parentState); })
      .catch(() => { if (current) setOptions(value => ({ ...value, error: "This setup could not be verified. Choose an active, compatible setup." })); });
    return () => { current = false; };
  }, [campaignId, adSetId, workspaceId]);
  async function searchLocations() {
    if (locationQuery.trim().length < 2 || !country) return;
    setLocationBusy(true); setLocationError("");
    try {
      const response = await fetch("/api/adstudio/publish-options?workspaceId=" + encodeURIComponent(workspaceId) + "&q=" + encodeURIComponent(locationQuery.trim()) + "&country=" + encodeURIComponent(country));
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Areas could not be loaded.");
      const found = (body.locations ?? []) as PublishAudienceLocation[];
      setLocations(current => [...new Map([...current.filter(item => selectedLocationKeys.includes(item.key)), ...found].map(item => [item.key, item])).values()]);
      if (!found.length) setLocationError("No matching areas. Try another town or suburb.");
    } catch (error) { setLocationError(error instanceof Error ? error.message : "Area search unavailable."); }
    finally { setLocationBusy(false); }
  }
  async function publish() {
    if (!ready || !build.controls || submitting || creationLocked) return;
    requestVersion.current += 1; setSubmitting(true); setModalOpen(true); setManualError("");
    try {
      if (!metaConnectionConnected) {
        const response = await fetch("/api/adstudio/ads/" + encodeURIComponent(adId) + "/manual-publish", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, mutationId: manualMutationId, notes: manualNotes.trim() || undefined,
            controls: build.controls, publishSummary: build.summary, revisionId: initialState?.revision.id, documentHash: initialState?.revision.documentHash }),
        });
        const body = await response.json();
        if (!response.ok) { setManualError(body.error || "Publishing request could not be sent."); return; }
        setManualStatus(body.request?.status ?? "requested");
      } else {
        const response = await fetch("/api/adstudio/ads/" + encodeURIComponent(adId) + "/publish?workspaceId=" + encodeURIComponent(workspaceId), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ controls: build.controls, approveAndPublish: true }),
        });
        const body = await response.json() as PublishReceipt;
        setReceipt(response.ok ? body : { ...body, error: body.error || "publish_failed" });
      }
    } catch {
      setRefreshError("The response was interrupted. Check publish status before trying again.");
      await refreshReceipt();
    } finally { setSubmitting(false); }
  }
  async function resumePublish() {
    if (!receipt?.planId || submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/adstudio/ads/" + encodeURIComponent(adId) + "/publish?workspaceId=" + encodeURIComponent(workspaceId), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumePlanId: receipt.planId }),
      });
      const body = await response.json() as PublishReceipt;
      if (!response.ok) { setReceipt(current => ({ ...current, error: body.error, message: body.message })); return; }
      setReceipt(current => ({ ...current, ...body }));
    } catch { setRefreshError("The retry response was interrupted. Refresh the saved status."); }
    finally { setSubmitting(false); }
  }
  function resetRecommended() {
    setTargetMode("new_campaign_new_adset"); setCampaignId(""); setAdSetId("");
    setBudgetMode("campaign"); setPlacementsMode("automatic"); setVariants(["feed", "story"]);
    // Keep the user's amount, area, timing, destination and offer unchanged.
  }
  if (notSaved) return <div className="p-6"><h1 className="text-xl font-semibold">Save before publishing</h1><p className="mt-2 text-sm text-muted-foreground">Return to the editor and save the version you want to publish.</p><Button asChild className="mt-4"><Link href={"/ad-studio/ads/" + encodeURIComponent(adId)}>Back to editor</Link></Button></div>;

  return <div className="flex h-full min-h-0 flex-col bg-background">
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <nav aria-label="Publish progress" className="mb-6">
          <ol className="flex gap-1 border-b border-border sm:gap-5">
            {steps.map((label, index) => <li key={label} className="min-w-0 flex-1 sm:flex-none">
              <Button variant="ghost" aria-current={stage === index ? "step" : undefined} onClick={() => setStage(index)} className={`min-h-11 w-full rounded-none border-b-2 px-1 text-xs sm:px-3 sm:text-sm ${stage === index ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>{index + 1}. {label}</Button>
            </li>)}
          </ol>
        </nav>
        <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <aside className={`min-w-0 lg:sticky lg:top-0 lg:self-start ${stage !== 2 ? "hidden lg:block" : ""}`} aria-label="Saved ad preview">
            <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Your ad</h2><div className="flex gap-1">{(["feed", "story"] as const).map(value => <Button key={value} size="sm" variant={format === value ? "secondary" : "ghost"} aria-pressed={format === value} onClick={() => setFormat(value)}>{value === "feed" ? "Feed" : "Story"}</Button>)}</div></div>
            <div className="overflow-hidden rounded-(--r-card) border border-border bg-card">
              {format === "feed" && initialState?.ad.metaPrimaryText ? <p className="whitespace-pre-wrap p-4 text-sm">{initialState.ad.metaPrimaryText}</p> : null}
              {previewPath ? <img src={"/api/adstudio/media?path=" + encodeURIComponent(previewPath)} alt={`Saved ${format} creative`} className="max-h-[52dvh] w-full object-contain" /> : <p className="p-6 text-sm text-muted-foreground">Save this format in the editor to preview it.</p>}
              <div className="border-t border-border p-4"><p className="font-semibold">{initialState?.ad.metaHeadline || templateName}</p>{initialState?.ad.metaDescription ? <p className="mt-1 text-sm text-muted-foreground">{initialState.ad.metaDescription}</p> : null}<p className="mt-2 text-sm font-medium">{initialState?.ad.metaCta?.replaceAll("_", " ")}</p></div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Saved creative. Appearance varies by placement.</p><Button asChild variant="link" size="sm"><Link href={"/ad-studio/ads/" + encodeURIComponent(adId)}>Edit ad</Link></Button></div>
          </aside>
          <div className="min-w-0">
            <h1 ref={stageRef} tabIndex={-1} className="mb-6 text-2xl font-semibold tracking-tight focus:outline-none">{stage === 0 ? "Where your leads go" : stage === 1 ? "Set up your lead campaign" : "Review your ad"}</h1>
            {initialIssues.length ? <Issues issues={initialIssues} /> : null}
            <section hidden={stage !== 0} className="space-y-6" aria-label="Lead capture">
              <div className="flex items-start justify-between gap-4 border-b border-border pb-5"><div><h2 className="text-sm font-semibold">Lead destination</h2><p className="mt-1 text-sm">{publishingDefaults?.leadDestination || "Not configured yet"}</p></div><Button asChild variant="outline" size="sm"><Link href="/settings">Change</Link></Button></div>
              {requiresForm ? <InstantFormEditor adId={adId} workspaceId={workspaceId} onPinStateChange={onPinStateChange} /> : <p className="text-sm text-muted-foreground">This template sends people to your website. Its lead capture is managed there.</p>}
              <div><Label htmlFor="publish-destination-url">{requiresForm ? "Page shown after submitting the form" : "Lead capture page"}</Label><Input id="publish-destination-url" type="url" value={destinationUrl} onChange={event => setDestinationUrl(event.target.value)} placeholder="https://" className="mt-2 min-h-11" aria-invalid={Boolean(destinationUrl) && !validHttpsUrl(destinationUrl)} /><p className="mt-2 text-xs text-muted-foreground">{requiresForm ? "The form’s thank-you button opens this page." : "Use the page promised by your ad."}</p></div>
              <div className="border-t border-border pt-4"><CheckField checked={offerEnabled} disabled={publishRequirements.fulfilmentRequired} onChange={setOfferEnabled}>This ad promises an offer, guide or result</CheckField>
              {offerEnabled ? <details open={publishRequirements.fulfilmentRequired} className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Offer and delivery details</summary><div className="grid gap-4 sm:grid-cols-2">{Object.entries({ exactOffer: "What you’re offering", eligibility: "Who it is for", conditions: "Conditions", timeframe: "Delivery timeframe", evidence: "Evidence for claims", approval: "Evidence approval", disclaimer: "Disclaimer", privacyUrl: "Privacy policy URL", consent: "Consent wording", fulfilmentUrl: "Offer delivery URL", owner: "Responsible person", expiry: "Expiry", tracking: "Delivery tracking" }).map(([key, label]) => <div key={key}><Label htmlFor={"offer-" + key}>{label}</Label><Input id={"offer-" + key} value={fulfilment[key as keyof PublishFulfilmentDraft]} onChange={event => setFulfilment(current => ({ ...current, [key]: event.target.value }))} className="mt-2 min-h-11" /></div>)}</div></details> : null}</div>
            </section>
            <section hidden={stage !== 1} className="space-y-6" aria-label="Audience and budget">
              <div className="border-b border-border pb-5">
                <div className="flex flex-wrap items-center gap-2"><Check className="size-4" aria-hidden="true" /><h2 className="font-semibold">{targetMode === "new_campaign_new_adset" && budgetMode === "campaign" && placementsMode === "automatic" ? "Generate leads" : "Custom setup"}</h2>{targetMode === "new_campaign_new_adset" && budgetMode === "campaign" && placementsMode === "automatic" ? <span className="rounded-full bg-muted px-2 py-1 text-xs">Recommended</span> : null}</div>
                <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Why use this campaign setup?</summary><div className="max-w-prose space-y-3 text-sm text-muted-foreground"><p>Keep your lead-generation ads together instead of splitting the budget across unnecessary campaigns and audiences.</p><p>The recommended setup uses one shared budget and eligible automatic placements. You control the creative, area, spend and where leads go. Your approved creative is not rewritten.</p><p>Customise the setup to use an existing campaign or ad set, or keep a budget separate. Results aren’t guaranteed.</p></div></details>
              </div>
              {targetMode === "existing_adset" ? <div className="space-y-2"><h2 className="font-semibold">Uses your existing setup</h2><p className="text-sm">{selectedCampaign?.name} · {selectedAdSet?.name}</p><p className="text-sm text-muted-foreground">Budget, audience, placements and schedule stay unchanged. Your new creative shares the existing budget with other ads.</p></div> : <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><Label htmlFor="publish-daily-budget">{existingBudget ? "Budget" : `Average daily budget (${currency})`}</Label>{existingBudget ? <p className="mt-2 text-sm">Uses existing campaign budget. No increase.</p> : <><Input id="publish-daily-budget" type="number" min="0.01" step="0.01" inputMode="decimal" value={dailyBudgetDollars} onChange={event => setDailyBudgetDollars(event.target.value)} className="mt-2 min-h-11" /><div className="mt-2 flex gap-1">{["10", "20", "30", "50"].map(value => <Button key={value} variant={dailyBudgetDollars === value ? "secondary" : "ghost"} size="sm" aria-pressed={dailyBudgetDollars === value} onClick={() => setDailyBudgetDollars(value)}>{value}</Button>)}</div></>}</div>
                  <Choice label="Ad country" id="publish-country" value={country} onChange={value => { setCountry(value); setSelectedLocationKeys([]); setLocations([]); }} options={[["AU", "Australia"]]} placeholder="Choose country" />
                </div>
                <div className="border-t border-border pt-5"><h2 className="mb-3 text-sm font-semibold">Who should see your ad?</h2><Label htmlFor="publish-area-search">Town or suburb</Label><div className="mt-2 flex gap-2"><Input id="publish-area-search" value={locationQuery} onChange={event => setLocationQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void searchLocations(); } }} placeholder="Search an area" className="min-h-11 min-w-0" /><Button variant="outline" disabled={!country || locationBusy || locationQuery.trim().length < 2 || !metaConnectionConnected} onClick={searchLocations}>{locationBusy ? "Searching…" : "Search"}</Button></div>
                {!metaConnectionConnected ? <p className="mt-2 text-xs text-muted-foreground">Connect Meta to search more areas. Saved areas are available below.</p> : null}
                {locationError ? <p className="mt-2 text-sm text-destructive" role="status">{locationError}</p> : null}
                <div className="mt-3 grid gap-1 sm:grid-cols-2">{locations.map(location => <CheckField key={location.key} checked={selectedLocationKeys.includes(location.key)} onChange={checked => setSelectedLocationKeys(current => checked ? [...current, location.key] : current.filter(key => key !== location.key))}>{location.name}{location.region ? `, ${location.region}` : ""}</CheckField>)}</div>
                {!locations.length ? <p className="mt-2 text-sm text-muted-foreground">Choose an area before publishing.</p> : null}
                <CheckField checked={includeNearby} onChange={setIncludeNearby}>Include nearby areas (25 km)</CheckField></div>
                <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
                  <div><Choice label="Starts" id="publish-start" value={startIntent} onChange={value => setStartIntent(value as ScheduleStartIntent)} options={[["as_soon_as_activated", "After publishing and Meta approval"], ["scheduled", "Choose a start time"]]} />{startIntent === "scheduled" ? <Input aria-label="Start date and time" type="datetime-local" value={startAt} onChange={event => setStartAt(event.target.value)} className="mt-2 min-h-11" /> : null}</div>
                  <div><Choice label="Ends" id="publish-end" value={endIntent} onChange={value => setEndIntent(value as ScheduleEndIntent)} options={[["scheduled", "Choose an end time"], ["run_until_paused", "When I pause it"]]} />{endIntent === "scheduled" ? <Input aria-label="End date and time" type="datetime-local" value={endAt} onChange={event => setEndAt(event.target.value)} className="mt-2 min-h-11" /> : null}</div>
                </div>
              </>}
              <details open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)} className="border-t border-border pt-2">
                <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Customise setup</summary>
                <div className="space-y-5 pt-3">
                  <Choice label="Campaign setup" id="publish-target" value={targetMode} onChange={value => { setTargetMode(value as PublishTargetMode); setCampaignId(""); setAdSetId(""); }} options={[["new_campaign_new_adset", "Create a separate campaign"], ["existing_campaign_new_adset", "Use existing campaign, new audience"], ["existing_adset", "Use existing campaign and ad set"]]} />
                  {targetMode !== "new_campaign_new_adset" ? <><Input aria-label="Find a campaign" placeholder="Find a campaign by name" value={campaignSearch} onChange={event => setCampaignSearch(event.target.value)} />
                  <Choice label="Campaign" id="publish-campaign" value={campaignId} onChange={value => { setCampaignId(value); setAdSetId(""); }} options={options.campaigns.filter(item => item.name.toLowerCase().includes(campaignSearch.toLowerCase())).map(item => [item.id, item.reason ? `${item.name} · ${item.reason}` : item.name, item.eligible === false])} placeholder={optionsBusy ? "Loading campaigns…" : "Choose a campaign"} />
                  {targetMode === "existing_adset" ? <Choice label="Ad set" id="publish-adset" value={adSetId} onChange={setAdSetId} options={options.adSets.filter(item => !item.campaignId || item.campaignId === campaignId).map(item => [item.id, item.reason ? `${item.name} · ${item.reason}` : item.name, item.eligible === false])} placeholder="Choose an ad set" /> : null}
                  {options.error ? <div role="status"><p className="text-sm text-destructive">{options.error}</p><Button variant="link" onClick={loadOptions}>Try again</Button></div> : !optionsBusy && !options.campaigns.length ? <p className="text-sm text-muted-foreground">No eligible campaigns are available. Use a new campaign or check your Meta connection.</p> : null}
                  <p className="text-xs text-muted-foreground">Existing budgets and other ads are not changed. Paused parent setups must be resolved before publishing.</p></> : <Choice label="Budget allocation" id="publish-budget-mode" value={budgetMode} onChange={value => setBudgetMode(value as PublishBudgetMode)} options={[["campaign", "One shared campaign budget (recommended)"], ["adset", "Separate budget for this audience"]]} />}
                  {targetMode !== "existing_adset" ? <><Choice label="Where your ad appears" id="publish-placements" value={placementsMode} onChange={value => setPlacementsMode(value as "automatic" | "manual")} options={[["automatic", "Automatic placements (recommended)"], ["manual", "Choose placements"]]} />{placementsMode === "manual" ? <div className="grid gap-1 sm:grid-cols-2">{placementOptions.map(([value, label]) => <CheckField key={value} checked={placementChoices.includes(value)} onChange={checked => setPlacementChoices(current => checked ? [...current, value] : current.filter(item => item !== value))}>{label}</CheckField>)}</div> : null}</> : null}
                  <fieldset><legend className="mb-2 text-sm font-medium">Creative versions</legend>{(["feed", "story"] as const).map(value => <CheckField key={value} checked={variants.includes(value)} onChange={checked => setVariants(current => checked ? [...current, value] : current.filter(item => item !== value))}>{value === "feed" ? "Feed" : "Story"}</CheckField>)}</fieldset>
                  <Button variant="outline" onClick={resetRecommended}>Reset to recommended</Button>
                </div>
              </details>
            </section>

            <section hidden={stage !== 2} aria-label="Final review" className="space-y-1">
              <ReviewRow title="Goal" value="Generate leads" />
              <ReviewRow title="Audience" value={targetMode === "existing_adset" ? "Uses existing audience" : build.summary?.audience || "Choose your area"} onChange={() => setStage(1)} />
              <ReviewRow title="Budget & schedule" value={<>{spendLabel}<br /><span className="text-muted-foreground">{targetMode === "existing_adset" ? "Existing schedule unchanged" : build.summary?.schedule || "Choose your schedule"}</span></>} onChange={() => setStage(1)} />
              <ReviewRow title="Lead capture" value={requiresForm ? <>{form?.contactFields.map(field => field.type.replaceAll("_", " ")).join(" · ") || "Save a lead form"}<br /><span className="text-muted-foreground">{publishingDefaults?.leadDestination || "Lead destination not configured"}</span></> : destinationUrl || "Add your website"} onChange={() => setStage(0)} />
              <ReviewRow title="After submitting" value={destinationUrl || "Add a thank-you page"} onChange={() => setStage(0)} />
              {offerEnabled ? <ReviewRow title="Offer" value={fulfilment.exactOffer || "Complete your offer"} onChange={() => setStage(0)} /> : null}
              <ReviewRow title="Setup" value={targetMode === "new_campaign_new_adset" ? "New lead-generation campaign" : <>{selectedCampaign?.name || "Choose a campaign"}{selectedAdSet ? " · " + selectedAdSet.name : ""}</>} onChange={() => { setStage(1); setAdvanced(true); }} />
              {!ready ? <div className="pt-4"><Issues issues={[...build.issues, ...(!currency ? ["Set your publishing currency in Settings before publishing."] : []), ...(!formReady ? ["Save your lead form before publishing."] : [])]} /></div> : null}
              {!metaConnectionConnected ? <div className="pt-4"><h2 className="text-sm font-semibold">Manual publishing request</h2><p className="mt-2 text-sm text-muted-foreground">A Blockwise operator will review this request. It does not send your ad directly to Meta.</p><Input aria-label="Note for publishing team" placeholder="Optional note for the publishing team" value={manualNotes} onChange={event => setManualNotes(event.target.value)} maxLength={500} className="mt-3" /></div> : !providerWritesEnabled ? <p className="pt-4 text-sm text-muted-foreground">Preview only. Nothing will be created or turned on in Meta.</p> : <p className="pt-4 text-sm text-muted-foreground">Approving sends this ad to Meta and turns on its new setup. Meta may review it before delivery starts.</p>}
            </section>
            {!currency ? <p className="mt-4 text-sm text-destructive" role="status">Set your publishing currency in <Link href="/settings" className="underline">Settings</Link> before publishing.</p> : null}
            {receiptLoading ? <p className="mt-4 text-sm text-muted-foreground" role="status">Checking saved publish status…</p> : null}
            {refreshError ? <div className="mt-4" role="alert"><p className="text-sm text-destructive">{refreshError}</p><Button variant="outline" className="mt-2" onClick={refreshReceipt}>Check publish status</Button></div> : null}
            {creationLocked || receipt?.error || manualStatus ? <div className="mt-5 border-t border-border pt-4"><p className="text-sm font-semibold" role="status">{manualStatus ? manualLabel(manualStatus) : outcome.title}</p><Button variant="link" onClick={() => setModalOpen(true)}>View publish status</Button></div> : null}
          </div>
        </div>
      </div>
    </div>
    <footer className="shrink-0 border-t border-border bg-card px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => stage > 0 ? setStage(stage - 1) : window.location.assign("/ad-studio/ads/" + encodeURIComponent(adId))}>Back</Button>
        <div className="flex min-w-0 flex-1 flex-col items-end gap-2">
          {stage === 2 ? <div className="text-right"><p className="text-sm font-semibold tabular-nums">{spendLabel}</p><p className="max-w-sm text-xs text-muted-foreground">{existingBudget ? "Shared with existing ads, not a per-ad allowance." : "Daily spend can vary. No total spending cap is set."}</p></div> : null}
          {stage < 2 ? <Button disabled={stage === 0 ? !captureReady : !ready} onClick={() => setStage(stage + 1)} className="min-h-11">{stage === 0 ? "Continue" : "Review ad"}</Button> : <Button onClick={publish} disabled={!ready || receiptLoading || Boolean(refreshError) || submitting || Boolean(creationLocked) || (!metaConnectionConnected && (!canRequestManualPublish || ["requested", "in_progress", "completed"].includes(manualStatus)))} className="min-h-11">{submitting ? "Publishing…" : metaConnectionConnected ? providerWritesEnabled ? "Approve & publish" : "Preview publish setup" : "Request manual publishing"}</Button>}
        </div>
      </div>
    </footer>
    <Dialog open={modalOpen} onOpenChange={setModalOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader><div className="mb-2">{pending ? <Loader2 className="size-7 animate-spin motion-reduce:animate-none" /> : outcome.attention || manualError ? <CircleAlert className="size-7 text-destructive" /> : <Check className="size-7" />}</div><DialogTitle>{pending ? "Publishing your ad…" : manualError ? "Publishing request not sent" : manualStatus ? manualLabel(manualStatus) : outcome.title}</DialogTitle><DialogDescription>{pending ? "Your approved setup is saved while Blockwise checks Meta’s response." : manualStatus ? "This is a Blockwise publishing request, not confirmation that your ad is live on Meta." : outcome.description}</DialogDescription></DialogHeader>
        <div className="flex items-center gap-4 border-y border-border py-4">{initialState?.revision.feedPngPath ? <img src={"/api/adstudio/media?path=" + encodeURIComponent(receipt?.publishedCreative?.feedPngPath || initialState.revision.feedPngPath)} alt="Submitted ad" className="h-24 w-20 rounded-(--r-ctl) object-contain" /> : null}<div className="min-w-0"><p className="font-semibold">{receipt?.publishedCreative?.headline || initialState?.ad.metaHeadline || templateName}</p><p className="mt-1 text-sm">{persistedSummary?.budget || spendLabel}</p><p className="mt-1 text-xs text-muted-foreground">{persistedSummary?.schedule || build.summary?.schedule}</p></div></div>
        {receipt?.error ? <p className="text-sm text-destructive" role="alert">{receipt.message || "Publishing needs attention. Check the saved status before retrying."}</p> : null}
        {receipt?.issues?.length || receipt?.blockers?.length ? <Issues issues={[...(receipt.issues ?? []), ...(receipt.blockers ?? [])]} /> : null}
        {manualError ? <p role="alert" className="text-sm text-destructive">{manualError}</p> : null}
        {receipt?.metaStatus ? <dl className="grid grid-cols-3 gap-3 text-sm">{Object.entries(receipt.metaStatus).map(([key, value]) => <div key={key}><dt className="text-xs text-muted-foreground">{key === "campaign" ? "Campaign" : key === "adSets" ? "Ad set" : "Ad"}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}</dl> : receipt?.status === "active" ? <p className="text-sm">Meta accepted the activation. Delivery is not yet confirmed.</p> : null}
        <DialogFooter className="gap-2"><Button asChild variant="outline"><Link href="/ad-studio/templates">Create another ad</Link></Button><Button asChild><Link href={performanceUrl}>View in Performance</Link></Button></DialogFooter>
        {creationLocked || refreshError ? <Button variant="ghost" onClick={refreshReceipt}>Refresh status</Button> : null}
        {receipt?.activationRequested && receipt.status === "failed" && !receipt.activationError ? <Button variant="outline" disabled={submitting} onClick={resumePublish}>Retry publishing</Button> : null}
        {outcome.attention ? <Button asChild variant="link"><Link href="/help">Get publishing help</Link></Button> : null}
      </DialogContent>
    </Dialog>
  </div>;
}

function Choice({ label, id, value, onChange, options, placeholder }: { label: string; id: string; value: string; onChange: (value: string) => void; options: Array<[string, string, boolean?]>; placeholder?: string }) {
  return <div className="min-w-0"><Label htmlFor={id}>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger id={id} className="mt-2 min-h-11 w-full"><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{options.map(([key, text, disabled]) => <SelectItem key={key} value={key} disabled={disabled}>{text}</SelectItem>)}</SelectContent></Select></div>;
}
function CheckField({ checked, onChange, disabled, children }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; children: ReactNode }) {
  return <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><Checkbox checked={checked} disabled={disabled} onCheckedChange={value => onChange(value === true)} />{children}</label>;
}
function ReviewRow({ title, value, onChange }: { title: string; value: ReactNode; onChange?: () => void }) {
  return <div className="flex items-start justify-between gap-4 border-b border-border py-4"><div className="min-w-0"><h2 className="text-sm font-semibold">{title}</h2><div className="mt-1 break-words text-sm">{value}</div></div>{onChange ? <Button variant="link" size="sm" onClick={onChange}>Change</Button> : null}</div>;
}
function Issues({ issues }: { issues: string[] }) {
  if (!issues.length) return null;
  return <div role="status" className="mb-4 rounded-(--r-ctl) border border-border bg-muted/50 p-3"><h2 className="text-sm font-semibold">Before you publish</h2><ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted-foreground">{[...new Set(issues)].map(issue => <li key={issue}>{issue}</li>)}</ul></div>;
}
function validHttpsUrl(value: string) { try { return new URL(value.trim()).protocol === "https:"; } catch { return false; } }
function manualLabel(status: string) { return status === "completed" ? "Publishing request completed" : status === "in_progress" ? "Blockwise is reviewing your request" : status === "cancelled" ? "Publishing request cancelled" : "Publishing request sent"; }
function publishOutcome(receipt: PublishReceipt | null) {
  if (!receipt) return { title: "Checking publish status", description: "The result is not confirmed yet.", label: "Not confirmed", attention: true };
  if (receipt.mode === "dry_run") return { title: "Preview complete", description: "Nothing was created or turned on in Meta.", label: "Preview only", attention: false };
  if (receipt.deliveryStatus === "needs_attention" || receipt.error || ["unknown", "paused", "failed"].includes(receipt.status ?? "")) return { title: "Publishing needs attention", description: receipt.status === "unknown" ? "Meta’s final state is not confirmed. Ads may be running. Check the saved status before retrying." : receipt.status === "paused" ? "The setup is saved on Meta, but publishing has not finished. It is not confirmed as delivering." : "Check the details below before trying again.", label: "Needs attention", attention: true };
  if (receipt.deliveryStatus === "in_review") return { title: "Your ad has been sent to Meta", description: "Meta is reviewing your ad. Check Performance for its latest status.", label: "In review", attention: false };
  if (receipt.deliveryStatus === "live") return { title: "Your ad is live", description: "Meta has confirmed delivery. Follow your leads and spending in Performance.", label: "Live", attention: false };
  if (receipt.deliveryStatus === "scheduled") return { title: "Your ad is scheduled", description: "Your ad is set to start at the approved time, subject to Meta’s review.", label: "Scheduled", attention: false };
  return { title: "Your ad has been sent to Meta", description: "Delivery is not yet confirmed. Follow the latest status in Performance.", label: "Not yet confirmed", attention: false };
}
