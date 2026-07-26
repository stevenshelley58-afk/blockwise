"use client";

import { ArrowRight, Check, ChevronDown, Link2, MapPinned, Palette, PartyPopper } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, type FormEvent } from "react";

import { AssetUploadDropzone } from "@/components/asset-upload-dropzone";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Confetti } from "@/components/ui/confetti";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReducedMotion } from "@/lib/motion";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  LOGO_MAX_BYTES,
  LOGO_UPLOAD_TYPES,
  readFileAsDataUrl,
  sanitizeUploadFileName,
  validateAssetUploadFile,
} from "@/lib/upload/asset-file";

const REGION_CURRENCY: Record<string, string> = { AU: "AUD", NZ: "NZD", GB: "GBP", US: "USD", CA: "CAD" };

const REGION_NAMES: Record<string, string> = {
  AU: "Australia",
  NZ: "New Zealand",
  GB: "United Kingdom",
  US: "United States",
  CA: "Canada",
};

type JsonObject = Record<string, unknown>;

type BrandKitRow = {
  id: string;
  source_type?: string | null;
  source_url?: string | null;
  business_name?: string | null;
  market_country?: string | null;
  market_region?: string | null;
  identity_json?: JsonObject | null;
  logos_json?: JsonObject | null;
  colours_json?: JsonObject | null;
  typography_json?: JsonObject | null;
  tone_json?: JsonObject | null;
  visual_style_json?: JsonObject | null;
  compliance_json?: JsonObject | null;
  contact_json?: JsonObject | null;
  review_status?: string | null;
  locked_fields_json?: unknown[] | null;
};

type WizardProps = {
  workspaceId: string;
  agencyName: string;
  region: string;
  brandKit: BrandKitRow | null;
  canSaveProfile: boolean;
  canSaveBrand: boolean;
  canManageConnections: boolean;
  canOpenCampaigns: boolean;
  googleAdsEnabled: boolean;
};

type StepId = "profile" | "brand" | "connect";

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "brand", label: "Brand" },
  { id: "connect", label: "Connect" },
];

const DEFAULT_COLOURS = {
  primary: "#123E75",
  secondary: "#F1F5F9",
  accent: "#31C46F",
  background: "#FFFFFF",
  text: "#131B2E",
  confidence: { primary: 0.52, secondary: 0.48 },
};

const DEFAULT_LOGOS = {
  primaryLogoUrl: null,
  darkLogoUrl: null,
  lightLogoUrl: null,
  faviconUrl: null,
};

export function OnboardingWizard({
  workspaceId,
  agencyName,
  region,
  brandKit,
  canSaveProfile,
  canSaveBrand,
  canManageConnections,
  canOpenCampaigns,
  googleAdsEnabled,
}: WizardProps) {
  const router = useRouter();
  const initialColours = (brandKit?.colours_json ?? {}) as JsonObject;
  const initialTone = (brandKit?.tone_json ?? {}) as JsonObject;
  const [stepIndex, setStepIndex] = useState(0);
  const [profileName, setProfileName] = useState(agencyName);
  const [profileRegion, setProfileRegion] = useState(region);
  const [brandKitId, setBrandKitId] = useState(brandKit?.id ?? null);
  const [brandColor, setBrandColor] = useState(String(initialColours.primary ?? DEFAULT_COLOURS.primary));
  const [brandTone, setBrandTone] = useState(String(initialTone.voice ?? "professional local expert"));
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const reducedMotion = useReducedMotion();

  const current = STEPS[stepIndex].id;
  const progressPercent = Math.round((stepIndex / (STEPS.length - 1)) * 100);
  const workspaceQuery = encodeURIComponent(workspaceId);
  const metaConnectHref = `/api/integrations/meta/connect?workspaceId=${workspaceQuery}&returnPath=%2Fonboarding`;
  const googleConnectHref = `/api/integrations/google/connect?workspaceId=${workspaceQuery}`;

  function next() {
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
    setMessage(null);
  }

  function back() {
    setStepIndex((i) => Math.max(i - 1, 0));
    setMessage(null);
  }

  async function finishOnboarding() {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/workspace/onboarding-status", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, status: "complete" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "We couldn't finish setup yet.");
      }

      if (reducedMotion) {
        router.push("/ad-studio?first=1");
        router.refresh();
      } else {
        setCelebrating(true);
      }
    } catch (caught) {
      setBusy(false);
      setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "We couldn't finish setup yet." });
    }
  }

  // After the one-and-only confetti moment (first-run setup complete), hand
  // off to Ad Studio. The burst is brief and never loops.
  useEffect(() => {
    if (!celebrating) return;
    const timer = setTimeout(() => {
      router.push("/ad-studio?first=1");
      router.refresh();
    }, 1600);
    return () => clearTimeout(timer);
  }, [celebrating, router]);

  async function chooseLogo(file: File) {
    setMessage(null);
    try {
      const previewUrl = await readFileAsDataUrl(file);
      setLogoFile(file);
      setLogoPreviewUrl(previewUrl);
    } catch {
      setLogoFile(null);
      setLogoPreviewUrl("");
      throw new Error("Could not read that logo.");
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSaveProfile) {
      next();
      return;
    }

    setBusy(true);
    setMessage(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase
      .from("workspaces")
      .update({ name: profileName.trim(), region: profileRegion.trim() || "AU", updated_at: new Date().toISOString() })
      .eq("id", workspaceId);

    setBusy(false);
    if (error) {
      setMessage({ tone: "error", text: "We couldn't save your profile yet. Try again or continue later." });
      return;
    }
    next();
  }

  async function saveBrand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSaveBrand) {
      next();
      return;
    }

    const logoError = logoFile
      ? validateAssetUploadFile(logoFile, {
          acceptedTypes: LOGO_UPLOAD_TYPES,
          maxBytes: LOGO_MAX_BYTES,
          typeError: "Upload a PNG, JPG, WebP, or SVG logo under 5 MB.",
          sizeError: "Upload a PNG, JPG, WebP, or SVG logo under 5 MB.",
        })
      : null;
    if (logoError) {
      setLogoFile(null);
      setLogoPreviewUrl("");
      setMessage({ tone: "error", text: logoError });
      return;
    }

    setBusy(true);
    setMessage(null);

    const supabase = createSupabaseBrowserClient();
    const id = brandKitId ?? crypto.randomUUID();
    const colours = { ...DEFAULT_COLOURS, ...(brandKit?.colours_json ?? {}), primary: brandColor };
    const tone = {
      avoid: ["hype", "cheap urgency", "unsupported guarantees"],
      preferredPhrases: [],
      sampleCopy: [],
      ...(brandKit?.tone_json ?? {}),
      voice: brandTone.trim() || "professional local expert",
    };
    const now = new Date().toISOString();
    const { error: kitError } = await supabase.from("adstudio_brand_kits").upsert(
      {
        id,
        workspace_id: workspaceId,
        source_type: brandKit?.source_type ?? "manual",
        source_url: brandKit?.source_url ?? null,
        business_name: profileName.trim() || agencyName,
        market_country: brandKit?.market_country ?? "AU",
        market_region: profileRegion.trim() || null,
        identity_json: {
          ...(brandKit?.identity_json ?? {}),
          businessName: profileName.trim() || agencyName,
          tradingName: profileName.trim() || agencyName,
          marketCountry: "AU",
          marketRegion: profileRegion.trim() || null,
          licenceText: brandKit?.identity_json?.licenceText ?? null,
        },
        logos_json: brandKit?.logos_json ?? DEFAULT_LOGOS,
        colours_json: colours,
        typography_json: brandKit?.typography_json ?? {
          headingFont: "Inter",
          bodyFont: "Inter",
          fallbackHeading: "sans-serif",
          fallbackBody: "sans-serif",
        },
        tone_json: tone,
        visual_style_json: brandKit?.visual_style_json ?? {
          styleTags: ["professional", "local", "clean"],
          imageTreatment: "Bright local property imagery with clean brand typography.",
          layoutDensity: "low",
          cornerRadius: "small",
        },
        compliance_json: brandKit?.compliance_json ?? { disclaimers: [], privacyPolicyUrl: null, termsUrl: null },
        contact_json: brandKit?.contact_json ?? { phone: null, email: null, address: null, socialLinks: [] },
        review_status: brandKit?.review_status ?? "pending_user_review",
        locked_fields_json: brandKit?.locked_fields_json ?? [],
        updated_at: now,
      },
      { onConflict: "id" },
    );

    if (kitError) {
      setBusy(false);
      setMessage({ tone: "error", text: "We couldn't save your brand yet. Try again or continue later." });
      return;
    }

    if (logoFile) {
      const safeName = sanitizeUploadFileName(logoFile.name);
      const storagePath = `${workspaceId}/brand/${id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("workspace-artifacts").upload(storagePath, logoFile);

      if (uploadError) {
        setBusy(false);
        setMessage({ tone: "error", text: "We couldn't upload that logo. Try another file or continue without it." });
        return;
      }

      const { error: assetError } = await supabase.from("adstudio_brand_assets").insert({
        workspace_id: workspaceId,
        brand_kit_id: id,
        asset_type: "logo",
        storage_path: storagePath,
        source_url: null,
        metadata_json: { fileName: logoFile.name, contentType: logoFile.type, size: logoFile.size },
      });

      if (assetError) {
        setBusy(false);
        setMessage({ tone: "error", text: "We uploaded the file but couldn't attach it to your brand yet." });
        return;
      }
    }

    setBrandKitId(id);
    setLogoFile(null);
    setLogoPreviewUrl("");
    setBusy(false);
    next();
  }

  const panelClass = "rounded-(--r-panel) border border-(--line) bg-(--surface) p-6 shadow-card";
  const selectClass =
    "h-9 w-full appearance-none rounded-(--r-card) border border-(--line) bg-(--surface) px-2.5 pr-7 text-[12.5px] font-semibold text-foreground outline-none transition-[border-color] duration-150 focus:border-(--ink) disabled:cursor-not-allowed disabled:opacity-50";
  const connectRowClass = "flex items-center justify-between gap-4 rounded-(--r-card) border border-(--line) bg-(--surface-subtle)/40 px-4 py-3";
  const inkLinkClass =
    "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-(--ink) px-4 text-[12.5px] font-bold text-white transition-[opacity,transform] duration-150 hover:opacity-85 active:scale-[0.97]";
  const ghostLinkClass =
    "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-(--line-heavy) bg-card px-3.5 text-[12.5px] font-bold text-foreground transition-[background,box-shadow] duration-150 hover:bg-(--surface-subtle) hover:shadow-card";
  const statusClass = (tone: "success" | "error") =>
    `text-[12.5px] font-bold ${tone === "error" ? "text-error" : "text-success"}`;
  const stepIconClass = "grid size-10 shrink-0 place-items-center rounded-full bg-success-soft text-success";
  const stepTitleClass = "font-display text-[17px] font-extrabold tracking-[-0.015em]";
  const stepLeadClass = "mt-0.5 text-[13px] text-muted-foreground";

  return (
    <section className="grid gap-5">
      <div>
        <ol aria-label="Setup steps" className="flex items-start">
          {STEPS.map((step, i) => {
            const state = i < stepIndex ? "done" : i === stepIndex ? "active" : "todo";
            return (
              <Fragment key={step.id}>
                <li className="flex w-16 flex-col items-center gap-1.5 sm:w-20">
                  <span
                    aria-current={state === "active" ? "step" : undefined}
                    className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors duration-200 ${
                      state === "done"
                        ? "bg-(--ink) text-white"
                        : state === "active"
                          ? "border-2 border-(--ink) bg-(--surface) text-(--ink)"
                          : "border border-(--line) bg-(--surface) text-(--faint)"
                    }`}
                  >
                    {state === "done" ? <Check size={14} aria-hidden /> : i + 1}
                  </span>
                  <span className={`text-[11px] font-bold ${state === "todo" ? "text-(--faint)" : "text-foreground"}`}>
                    {step.label}
                  </span>
                </li>
                {i < STEPS.length - 1 ? (
                  <li aria-hidden="true" className="mt-[15px] h-0.5 flex-1 overflow-hidden rounded-full bg-(--line)">
                    <span
                      className="block h-full rounded-full bg-(--ink) transition-[width] duration-300 ease-out"
                      style={{ width: i < stepIndex ? "100%" : "0%" }}
                    />
                  </li>
                ) : null}
              </Fragment>
            );
          })}
        </ol>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-(--line)">
            <span
              className="block h-full rounded-full bg-(--ink) transition-[width] duration-300 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
            Step {stepIndex + 1} of {STEPS.length}
          </span>
        </div>
      </div>

      <div className={panelClass}>
        {current === "profile" ? (
          <form className="grid gap-4" onSubmit={saveProfile}>
            <div className="flex items-start gap-3">
              <span className={stepIconClass}>
                <MapPinned size={20} aria-hidden />
              </span>
              <div>
                <h2 className={stepTitleClass}>Confirm your profile</h2>
                <p className={stepLeadClass}>These details come from your signed-in workspace.</p>
              </div>
            </div>
            {!canSaveProfile ? (
              <div>
                <StatusPill tone="blue">Managed by an owner or admin</StatusPill>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="ob-business">Business name</Label>
              <Input
                id="ob-business"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                readOnly={!canSaveProfile}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ob-region">Region</Label>
              <span className="relative block">
                <select
                  id="ob-region"
                  className={selectClass}
                  value={profileRegion}
                  onChange={(event) => setProfileRegion(event.target.value)}
                  disabled={!canSaveProfile}
                  required
                >
                  {Object.keys(REGION_CURRENCY).map((r) => (
                    <option key={r} value={r}>{REGION_NAMES[r] ?? r}</option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-(--faint)" />
              </span>
            </div>
            {message ? <p className={statusClass(message.tone)}>{message.text}</p> : null}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <Button variant="outline" type="button" disabled={busy} onClick={next}>
                Skip for now
              </Button>
              <Button type="submit" disabled={busy}>
                {canSaveProfile ? "Save and continue" : "Continue"} <ArrowRight size={16} aria-hidden />
              </Button>
            </div>
          </form>
        ) : null}

        {current === "brand" ? (
          <form className="grid gap-4" onSubmit={saveBrand}>
            <div className="flex items-start gap-3">
              <span className={stepIconClass}>
                <Palette size={20} aria-hidden />
              </span>
              <div>
                <h2 className={stepTitleClass}>Add your brand</h2>
                <p className={stepLeadClass}>
                  {canSaveBrand
                    ? "Your colour and tone guide drafts. Logo uploads are stored with your brand assets for review."
                    : "An owner, admin, or member can update brand assets. You can keep going with the current workspace defaults."}
                </p>
              </div>
            </div>
            {canSaveBrand ? (
              <>
                <div className="grid gap-2">
                  <Label>Logo asset</Label>
                  <AssetUploadDropzone
                    label="Upload logo"
                    actionText="Upload logo"
                    helperText="PNG, JPG, WebP, or SVG / up to 5 MB"
                    previewUrl={logoPreviewUrl}
                    previewAlt=""
                    fileName={logoFile?.name}
                    fileSize={logoFile?.size}
                    fileType={logoFile?.type}
                    acceptedTypes={LOGO_UPLOAD_TYPES}
                    maxBytes={LOGO_MAX_BYTES}
                    typeError="Upload a PNG, JPG, WebP, or SVG logo under 5 MB."
                    sizeError="Upload a PNG, JPG, WebP, or SVG logo under 5 MB."
                    capturePagePaste
                    disabled={busy}
                    onFileAccepted={chooseLogo}
                    onFileRejected={(text) => setMessage({ tone: "error", text })}
                    onClear={() => {
                      setLogoFile(null);
                      setLogoPreviewUrl("");
                      setMessage(null);
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ob-color">Brand colour</Label>
                  <input
                    id="ob-color"
                    type="color"
                    className="size-11 cursor-pointer rounded-(--r-card) border border-(--line) bg-(--surface) p-1"
                    value={brandColor}
                    onChange={(event) => setBrandColor(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ob-tone">Tone</Label>
                  <textarea
                    id="ob-tone"
                    className="min-h-20 w-full rounded-(--r-card) border border-(--line) bg-(--surface) px-3 py-2 text-sm text-foreground outline-none transition-[border-color] duration-150 focus:border-(--ink)"
                    value={brandTone}
                    onChange={(event) => setBrandTone(event.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className={connectRowClass}>
                <span className="text-sm font-semibold">Brand defaults</span>
                <StatusPill tone="blue">Ready</StatusPill>
              </div>
            )}
            {message ? <p className={statusClass(message.tone)}>{message.text}</p> : null}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <Button variant="outline" type="button" disabled={busy} onClick={back}>
                Back
              </Button>
              <Button variant="outline" type="button" disabled={busy} onClick={next}>
                Skip for now
              </Button>
              <Button type="submit" disabled={busy}>
                {canSaveBrand ? "Save and continue" : "Continue"} <ArrowRight size={16} aria-hidden />
              </Button>
            </div>
          </form>
        ) : null}

        {current === "connect" ? (
          <div className="grid gap-4">
            <div className="flex items-start gap-3">
              <span className={stepIconClass}>
                <Link2 size={20} aria-hidden />
              </span>
              <div>
                <h2 className={stepTitleClass}>Connect your ad accounts</h2>
                <p className={stepLeadClass}>
                  {canManageConnections
                    ? "Connect ad accounts when you are ready to publish. You can create ads before Meta is connected."
                    : "An owner or admin can connect ad accounts later when the workspace is ready to publish."}
                </p>
              </div>
            </div>
            <div className={connectRowClass}>
              <span className="text-sm font-semibold">Meta</span>
              {canManageConnections ? (
                <Link className={inkLinkClass} href={metaConnectHref}>
                  Connect Meta
                </Link>
              ) : (
                <Button variant="outline" disabled type="button">
                  Owner/admin only
                </Button>
              )}
            </div>
            <div className={connectRowClass}>
              <span className="text-sm font-semibold">Google</span>
              {canManageConnections && googleAdsEnabled ? (
                <Link className={ghostLinkClass} href={googleConnectHref}>
                  Connect Google
                </Link>
              ) : (
                <Button variant="outline" disabled type="button">
                  Not needed for Meta launch
                </Button>
              )}
            </div>
            {message ? <p className={statusClass(message.tone)}>{message.text}</p> : null}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <Button variant="outline" type="button" disabled={busy} onClick={back}>
                Back
              </Button>
              <Button variant="outline" type="button" disabled={busy} onClick={finishOnboarding}>
                Skip for now
              </Button>
              <Button type="button" disabled={busy} onClick={finishOnboarding}>
                Open Ad Studio <ArrowRight size={16} aria-hidden />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {celebrating ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-(--ink)/40 px-6 backdrop-blur-[2px]">
          <Confetti
            className="pointer-events-none absolute inset-0"
            options={{
              particleCount: 140,
              spread: 75,
              startVelocity: 32,
              origin: { y: 0.55 },
              colors: ["#2a78d6", "#31c46f", "#16181d", "#94a3b8"],
            }}
          />
          <div className="relative rounded-(--r-panel) border border-(--line) bg-(--surface) px-10 py-8 text-center shadow-float">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-success-soft text-success">
              <PartyPopper size={22} aria-hidden />
            </span>
            <h2 className="mt-3 font-display text-[19px] font-extrabold tracking-[-0.015em]">You're all set!</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Taking you to Ad Studio…</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
