"use client";

import { ArrowLeft, ArrowRight, Check, LoaderCircle, Save } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { VideoPreviewPlayer } from "@/components/adstudio/video/video-preview-player";
import { VIDEO_AUDIENCES, VIDEO_HOOKS, VIDEO_OBJECTIVES, VIDEO_PRESENTERS, VIDEO_RECIPES, buildVideoScenes, createVideoDraft } from "@/lib/adstudio/video/recipes";
import type { BrandSnapshot, VideoAsset, VideoDraft, VideoJobState, VideoRecipeId, VideoScriptPlan } from "@/lib/adstudio/video/types";

const STEPS = ["Audience", "Brief", "Approach", "Hook", "Assets", "Review"];

type GuidedDraft = VideoDraft & { recipeId: VideoRecipeId; serviceArea: string; offer: string; cta: string; presenterName: string; bookends: string; selectedAssetIds: string[] };
type ApiBody = { project?: { id?: string; status?: string; version?: number }; renderJob?: { status?: string }; scriptPlan?: VideoScriptPlan; renderUrl?: string | null; posterUrl?: string | null; captionsUrl?: string | null; job?: { status?: string }; error?: string };

export function VideoNewFlow({ workspaceId, brandAssets = [], brandSnapshot = {} }: { workspaceId: string; brandAssets?: VideoAsset[]; brandSnapshot?: BrandSnapshot }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<GuidedDraft>(() => createGuidedDraft(brandAssets));
  const [videoId, setVideoId] = useState<string | null>(null);
  const versionRef = useRef(1);
  const [state, setState] = useState<VideoJobState>("draft");
  const [scriptPlan, setScriptPlan] = useState<VideoScriptPlan | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scenes = useMemo(() => buildVideoScenes(draft.hook, draft.objective), [draft.hook, draft.objective]);
  const recipe = VIDEO_RECIPES[draft.recipeId];
  const selectedAssets = brandAssets.filter((asset) => draft.selectedAssetIds.includes(asset.id));
  const missingRequiredAssets = recipe.requiredAssets.filter((kind) => !selectedAssets.some((asset) => asset.kind === kind));
  const canPersist = draft.serviceArea.trim().length >= 2 && draft.offer.trim().length >= 2 && missingRequiredAssets.length === 0;
  const productionRoute = draft.presenter === "agent" ? "presenter" : draft.presenter;

  const projectInput = {
    recipeId: draft.recipeId,
    audience: VIDEO_AUDIENCES.find((item) => item.value === draft.audience)?.label ?? draft.audience,
    objective: VIDEO_OBJECTIVES.find((item) => item.value === draft.objective)?.label ?? draft.objective,
    brief: { serviceArea: draft.serviceArea.trim(), offer: draft.offer.trim(), cta: draft.cta.trim() || undefined, tone: "clear and local" },
    productionRoute,
    presenter: productionRoute === "presenter" ? draft.presenterName.trim() : undefined,
    bookends: productionRoute === "bookends" ? draft.bookends.trim() : undefined,
    hookStyle: draft.hook === "new_here" ? "offer" : draft.hook === "proof" ? "proof" : "question",
    brandSnapshot,
    assets: selectedAssets,
    captions: true,
    durationSeconds: 15 as const,
  };

  function update<K extends keyof GuidedDraft>(key: K, value: GuidedDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value, scenes: key === "hook" || key === "objective" ? buildVideoScenes(key === "hook" ? value as VideoDraft["hook"] : current.hook, key === "objective" ? value as VideoDraft["objective"] : current.objective) : current.scenes }));
  }

  async function request(path: string, options: RequestInit): Promise<ApiBody> {
    const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers ?? {}) } });
    const body = await response.json().catch(() => ({})) as ApiBody;
    if (!response.ok) throw new Error(body.error ?? `Video request failed (${response.status})`);
    return body;
  }

  function acceptProject(project?: ApiBody["project"]) {
    if (project?.id) setVideoId(project.id);
    if (project?.version) versionRef.current = project.version;
    if (project?.status) setState(normalizeJobState(project.status));
  }

  async function ensureVideo() {
    if (videoId) return videoId;
    const body = await request("/api/adstudio/videos", { method: "POST", body: JSON.stringify(projectInput) });
    if (!body.project?.id) throw new Error("The video draft was not created. Try again.");
    acceptProject(body.project);
    return body.project.id;
  }

  async function saveProject(id: string, plan?: VideoScriptPlan) {
    const body = await request(`/api/adstudio/videos/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ project: projectInput, ...(plan ? { plan: { scriptPlan: plan } } : {}), expectedVersion: versionRef.current }) });
    acceptProject(body.project);
    return body;
  }

  async function saveDraft() {
    if (!canPersist) return;
    setBusy(true); setError(null);
    try { const id = await ensureVideo(); await saveProject(id); setState("draft"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save this draft."); }
    finally { setBusy(false); }
  }

  async function generateScript() {
    setBusy(true); setError(null);
    try {
      const id = await ensureVideo();
      await saveProject(id);
      const body = await request(`/api/adstudio/videos/${encodeURIComponent(id)}/script`, { method: "POST", body: JSON.stringify({}) });
      if (!body.scriptPlan) throw new Error("The script was not returned. Your draft is safe; try again.");
      setScriptPlan(body.scriptPlan); acceptProject(body.project);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create the script."); }
    finally { setBusy(false); }
  }

  async function queueRender() {
    if (!scriptPlan) return;
    const reviewedPlan = synchronizeScriptPlan(scriptPlan);
    setScriptPlan(reviewedPlan);
    setBusy(true); setError(null); setState("queued");
    try {
      const id = await ensureVideo();
      await saveProject(id, reviewedPlan);
      const body = await request(`/api/adstudio/videos/${encodeURIComponent(id)}/render`, { method: "POST", body: JSON.stringify({ workspaceId }) });
      acceptProject(body.project); setRenderUrl(body.renderUrl ?? null); setPosterUrl(body.posterUrl ?? null); void pollProject(id);
    } catch (caught) { setState("failed"); setError(caught instanceof Error ? caught.message : "Could not queue the video."); }
    finally { setBusy(false); }
  }

  async function pollProject(id: string) {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 4000));
      try { const body = await request(`/api/adstudio/videos/${encodeURIComponent(id)}`, { method: "GET" }); acceptProject(body.project); if (body.renderUrl) setRenderUrl(body.renderUrl); if (body.posterUrl) setPosterUrl(body.posterUrl); if (["ready", "succeeded", "failed"].includes(body.project?.status ?? "")) return; }
      catch { return; }
    }
  }

  const canContinue = step === 1 ? draft.serviceArea.trim().length >= 2 && draft.offer.trim().length >= 2 && draft.brief.trim().length >= 20 : step === 2 ? (draft.presenter !== "agent" || draft.presenterName.trim().length >= 2) && (draft.presenter !== "bookends" || draft.bookends.trim().length >= 2) : true;

  return <div className="mx-auto w-full max-w-[1180px] px-4 py-6 pb-24 sm:px-6 lg:py-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><Link href="/ad-studio" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft aria-hidden className="size-4" /> Back to Create</Link><h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight sm:text-[27px]">Make a short video.</h1><p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">A guided 15-second story from one clear brief. No timeline, layers, or production setup.</p></div><Button type="button" variant="outline" onClick={() => void saveDraft()} disabled={busy || !canPersist} className="min-h-11 rounded-full"><Save aria-hidden className="size-4" /> {busy ? "Saving…" : "Save draft"}</Button></header>
    <div className="mt-7 grid gap-7 xl:grid-cols-[minmax(0,1fr)_360px]"><section aria-label="Video setup" className="min-w-0">
      <ol className="grid grid-cols-3 gap-1 sm:grid-cols-6" aria-label="Video setup steps">{STEPS.map((label, index) => <li key={label} className={`min-h-11 rounded-(--r-control) px-2 py-2 text-center text-[11px] font-semibold ${index === step ? "bg-primary text-primary-foreground" : index < step ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground"}`}>{label}</li>)}</ol>
      <Card className="mt-4 rounded-(--r-panel) border-(--line) shadow-card"><CardHeader><CardTitle>{STEPS[step]}</CardTitle><CardDescription>{step === 0 ? "Choose a lead-generation recipe, audience and outcome." : step === 1 ? "Give the story enough local detail to sound like you." : step === 2 ? "Choose the amount of camera presence that feels right." : step === 3 ? "Pick one opening idea. The rest follows the brief." : step === 4 ? "Use approved Brand Pack assets. Required assets are called out." : scriptPlan ? "Edit the generated script before you queue the render." : "Generate a script to review the four scenes."}</CardDescription></CardHeader><CardContent>
        {step === 0 ? <><ChoiceGroup label="Lead-generation recipe" value={draft.recipeId} options={Object.values(VIDEO_RECIPES).map((item) => ({ value: item.id, label: item.name, detail: item.audience }))} onChange={(value) => update("recipeId", value as VideoRecipeId)} /><div className="mt-6 grid gap-6 sm:grid-cols-2"><ChoiceGroup label="Audience" value={draft.audience} options={VIDEO_AUDIENCES} onChange={(value) => update("audience", value as VideoDraft["audience"])} /><ChoiceGroup label="Outcome" value={draft.objective} options={VIDEO_OBJECTIVES} onChange={(value) => update("objective", value as VideoDraft["objective"])} /></div></> : null}
        {step === 1 ? <div className="grid gap-5"><TextInput id="video-service-area" label="Service area" value={draft.serviceArea} onChange={(value) => update("serviceArea", value)} placeholder="e.g. Fremantle and nearby suburbs" /><TextInput id="video-offer" label="Offer or useful promise" value={draft.offer} onChange={(value) => update("offer", value)} placeholder="What should a homeowner or buyer get from this?" /><div><Label htmlFor="video-brief">Your 60-second brief</Label><textarea id="video-brief" value={draft.brief} onChange={(event) => update("brief", event.target.value)} placeholder="What are you showing, who is it for, and what should they do next?" rows={6} maxLength={600} className="mt-2 min-h-36 w-full resize-y rounded-(--r-card) border border-input bg-muted/30 px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" /><p className="mt-2 text-xs text-muted-foreground">{draft.brief.length}/600 · {draft.brief.trim().length < 20 ? "Add a little more detail to continue." : "Clear enough to shape four simple scenes."}</p></div><TextInput id="video-cta" label="CTA (optional)" value={draft.cta} onChange={(value) => update("cta", value)} placeholder={recipe.cta} /></div> : null}
        {step === 2 ? <><ChoiceGroup label="Camera approach" value={draft.presenter} options={VIDEO_PRESENTERS} onChange={(value) => update("presenter", value as VideoDraft["presenter"])} />{draft.presenter === "agent" ? <div className="mt-4"><TextInput id="video-presenter" label="Presenter name" value={draft.presenterName} onChange={(value) => update("presenterName", value)} placeholder="Who is speaking?" /></div> : null}{draft.presenter === "bookends" ? <div className="mt-4"><Label htmlFor="video-bookends">Opening and closing words</Label><textarea id="video-bookends" value={draft.bookends} onChange={(event) => update("bookends", event.target.value)} placeholder="What will you say at the start and end?" rows={4} maxLength={400} className="mt-2 min-h-28 w-full resize-y rounded-(--r-card) border border-input bg-muted/30 px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" /></div> : null}</> : null}
        {step === 3 ? <ChoiceGroup label="Opening hook" value={draft.hook} options={VIDEO_HOOKS} onChange={(value) => update("hook", value as VideoDraft["hook"])} /> : null}
        {step === 4 ? <AssetPicker assets={brandAssets} selectedIds={draft.selectedAssetIds} required={recipe.requiredAssets} optional={recipe.optionalAssets} onToggle={(id) => update("selectedAssetIds", draft.selectedAssetIds.includes(id) ? draft.selectedAssetIds.filter((item) => item !== id) : [...draft.selectedAssetIds, id])} /> : null}
        {step === 5 ? <ReviewPanel plan={scriptPlan} scenes={scenes} onPlanChange={setScriptPlan} /> : null}
      </CardContent></Card>
      {error ? <div role="alert" className="mt-4 rounded-(--r-card) border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error} <button type="button" onClick={() => setError(null)} className="ml-2 min-h-11 rounded-full px-2 font-semibold underline underline-offset-2">Dismiss</button></div> : null}
      {step === 5 && !canPersist ? <div role="status" className="mt-4 rounded-(--r-card) border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><p className="font-semibold">Finish setup before generating</p><p className="mt-1 text-muted-foreground">{missingRequiredAssets.length ? `Select required ${missingRequiredAssets.join(", ")} asset(s) in Assets.` : "Add a service area and offer in the Brief step."}</p></div> : null}
      <div className="mt-4 flex flex-wrap justify-between gap-2"><Button type="button" variant="ghost-pill" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || busy} className="min-h-11"><ArrowLeft aria-hidden className="size-4" /> Back</Button>{step < STEPS.length - 1 ? <Button type="button" onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))} disabled={!canContinue || busy} className="min-h-11">Continue <ArrowRight aria-hidden className="size-4" /></Button> : scriptPlan ? <Button type="button" onClick={() => void queueRender()} disabled={busy || !canPersist} className="min-h-11">{busy ? <><LoaderCircle aria-hidden className="size-4 animate-spin" /> Queueing…</> : "Queue render"}</Button> : <Button type="button" onClick={() => void generateScript()} disabled={busy || !canPersist} className="min-h-11">{busy ? <><LoaderCircle aria-hidden className="size-4 animate-spin" /> Writing…</> : "Generate script"}</Button>}</div>
    </section><aside className="xl:sticky xl:top-6 xl:self-start"><div className="mb-3"><p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">Workbench preview</p><h2 className="mt-1 font-display text-lg font-extrabold">Your story, at a glance.</h2></div><VideoPreviewPlayer scenes={scenes} renderUrl={renderUrl} posterUrl={posterUrl} />{state !== "draft" ? <p className="mt-3 rounded-(--r-card) border border-border bg-card p-3 text-sm text-muted-foreground" role="status">{state === "queued" ? "Queued — the render has been handed to the video service." : state === "rendering" ? "Rendering — this page will update when the service reports a result." : state === "ready" ? "Ready for review. The output link will appear when the media read model is available." : state === "failed" ? "Render failed. Your reviewed script is saved; retry when the service is available." : "Draft saved."}</p> : null}</aside></div>
  </div>;
}

function createGuidedDraft(brandAssets: VideoAsset[]): GuidedDraft { const base = createVideoDraft(); return { ...base, recipeId: "home_value", serviceArea: "", offer: "", cta: "", presenterName: "", bookends: "", selectedAssetIds: brandAssets.map((asset) => asset.id) }; }
function normalizeJobState(value: string | undefined): VideoJobState { if (value === "ready" || value === "succeeded") return "ready"; if (value === "rendering" || value === "running") return "rendering"; if (value === "failed") return "failed"; if (value === "draft" || value === "script_ready") return "draft"; return "queued"; }
function synchronizeScriptPlan(plan: VideoScriptPlan): VideoScriptPlan {
  const selectedHook = plan.hookVariants.find((hook) => hook.id === plan.selectedHookId);
  const scenes = plan.scenes.map((scene, index) => ({
    ...scene,
    narration: index === 0 && selectedHook ? selectedHook.text : scene.narration,
    overlay: limitWords(scene.overlay, 7),
  }));
  const body = scenes.map((scene) => scene.narration.trim()).filter(Boolean).join(" ");
  return { ...plan, scenes, body, wordCount: countWords(`${body} ${plan.cta}`) };
}
function limitWords(value: string, max: number): string { return value.trim().split(/\s+/u).filter(Boolean).slice(0, max).join(" "); }
function countWords(value: string): number { return value.trim().match(/\b[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?\b/gu)?.length ?? 0; }
function TextInput({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string }) { return <div><Label htmlFor={id}>{label}</Label><input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-2 min-h-11 w-full rounded-(--r-card) border border-input bg-muted/30 px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" /></div>; }
function ChoiceGroup({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string; detail: string }>; onChange: (value: string) => void }) { return <fieldset><legend className="text-sm font-semibold">{label}</legend><div className="mt-3 grid gap-2">{options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)} className={`min-h-16 rounded-(--r-card) border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === option.value ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/50"}`}><span className="block text-sm font-semibold">{option.label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{option.detail}</span></button>)}</div></fieldset>; }
function AssetPicker({ assets, selectedIds, required, optional, onToggle }: { assets: VideoAsset[]; selectedIds: string[]; required: string[]; optional: string[]; onToggle: (id: string) => void }) { return <div className="space-y-4"><div><p className="text-sm font-semibold">Assets for this recipe</p><p className="mt-1 text-xs text-muted-foreground">Required: {required.join(", ") || "none"} · Optional: {optional.join(", ") || "none"}</p></div>{assets.length ? <div className="grid gap-2 sm:grid-cols-2">{assets.map((asset) => <button key={asset.id} type="button" aria-pressed={selectedIds.includes(asset.id)} onClick={() => onToggle(asset.id)} className={`flex min-h-16 items-center gap-3 rounded-(--r-card) border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedIds.includes(asset.id) ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/50"}`}>{asset.url.startsWith("http") ? <img src={asset.url} alt={asset.alt ?? ""} className="size-10 rounded-(--r-control) object-cover" /> : <span className="grid size-10 place-items-center rounded-(--r-control) bg-muted text-xs font-bold">{asset.kind.slice(0, 1).toUpperCase()}</span>}<span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{asset.alt ?? asset.kind}</span><span className="block text-xs text-muted-foreground">{asset.kind}{required.includes(asset.kind) ? " · required" : " · optional"}</span></span>{selectedIds.includes(asset.id) ? <Check aria-hidden className="size-4 text-primary" /> : null}</button>)}</div> : <div className="rounded-(--r-card) border border-dashed border-border p-4 text-sm text-muted-foreground">No approved assets are available yet. <Link className="font-semibold text-foreground underline underline-offset-2" href="/ad-studio/library?tab=assets">Open Assets to upload or select one.</Link></div>}</div>; }
function ReviewPanel({ plan, scenes, onPlanChange }: { plan: VideoScriptPlan | null; scenes: ReturnType<typeof buildVideoScenes>; onPlanChange: (plan: VideoScriptPlan) => void }) { if (!plan) return <div className="rounded-(--r-card) border border-dashed border-border p-5 text-sm text-muted-foreground">Generate the script to review three opening options and the four fixed beats before rendering.</div>; return <div className="space-y-5"><div><p className="text-sm font-semibold">Choose a hook</p><div className="mt-2 grid gap-2">{plan.hookVariants.map((hook) => <button key={hook.id} type="button" aria-pressed={plan.selectedHookId === hook.id} onClick={() => onPlanChange({ ...plan, selectedHookId: hook.id })} className={`min-h-14 rounded-(--r-card) border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${plan.selectedHookId === hook.id ? "border-primary bg-primary/5" : "border-border bg-card"}`}><span className="text-xs font-semibold uppercase text-muted-foreground">{hook.style}</span><span className="mt-0.5 block text-sm font-semibold">{hook.text}</span></button>)}</div></div><div><Label htmlFor="video-script-body">Narration</Label><textarea id="video-script-body" value={plan.body} onChange={(event) => onPlanChange({ ...plan, body: event.target.value })} rows={6} className="mt-2 min-h-32 w-full resize-y rounded-(--r-card) border border-input bg-muted/30 px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" /></div><div><Label htmlFor="video-script-cta">CTA end card</Label><input id="video-script-cta" value={plan.cta} onChange={(event) => onPlanChange({ ...plan, cta: event.target.value })} className="mt-2 min-h-11 w-full rounded-(--r-card) border border-input bg-muted/30 px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50" /></div><div className="space-y-3"><p className="text-sm font-semibold">Four scene beats</p>{plan.scenes.map((scene, index) => <div key={scene.index} className="rounded-(--r-card) border border-border p-3"><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-(--r-control) bg-primary text-xs font-bold text-primary-foreground">{index + 1}</span><span className="text-sm font-semibold">{scenes[index]?.title ?? `Scene ${index + 1}`}</span></div><Label htmlFor={`video-overlay-${scene.index}`} className="mt-3 block text-xs">Overlay</Label><input id={`video-overlay-${scene.index}`} value={scene.overlay} onChange={(event) => onPlanChange({ ...plan, scenes: plan.scenes.map((item) => item.index === scene.index ? { ...item, overlay: event.target.value } : item) })} className="mt-1 min-h-11 w-full rounded-(--r-card) border border-input bg-muted/30 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50" /><Label htmlFor={`video-narration-${scene.index}`} className="mt-3 block text-xs">Narration</Label><textarea id={`video-narration-${scene.index}`} value={scene.narration} onChange={(event) => onPlanChange({ ...plan, scenes: plan.scenes.map((item) => item.index === scene.index ? { ...item, narration: event.target.value } : item) })} rows={3} className="mt-1 min-h-20 w-full resize-y rounded-(--r-card) border border-input bg-muted/30 px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2px focus-visible:ring-ring/50" /></div>)}</div></div>; }
