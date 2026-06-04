"use client";

import { ArrowRight, Check, Link2, MapPinned, Palette } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { StatusPill } from "@/components/status-pill";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

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

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const current = STEPS[stepIndex].id;
  const progressPercent = Math.round((stepIndex / (STEPS.length - 1)) * 100);
  const workspaceQuery = encodeURIComponent(workspaceId);
  const metaConnectHref = `/api/integrations/meta/connect?workspaceId=${workspaceQuery}`;
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

      router.push("/ad-studio?first=1");
      router.refresh();
    } catch (caught) {
      setBusy(false);
      setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "We couldn't finish setup yet." });
    }
  }

  function chooseLogo(file: File | undefined) {
    setMessage(null);
    if (!file) {
      setLogoFile(null);
      return;
    }

    if (!LOGO_TYPES.has(file.type) || file.size > MAX_LOGO_BYTES) {
      setLogoFile(null);
      setMessage({ tone: "error", text: "Upload a PNG, JPG, WebP, or SVG logo under 5 MB." });
      return;
    }

    setLogoFile(file);
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

    if (logoFile && (!LOGO_TYPES.has(logoFile.type) || logoFile.size > MAX_LOGO_BYTES)) {
      setLogoFile(null);
      setMessage({ tone: "error", text: "Upload a PNG, JPG, WebP, or SVG logo under 5 MB." });
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
      const safeName = logoFile.name.replace(/[^a-z0-9._-]/gi, "-").toLowerCase();
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
    setBusy(false);
    next();
  }

  return (
    <section className="wizard">
      <ol className="wizard-steps" aria-label="Setup steps">
        {STEPS.map((step, i) => {
          const state = i < stepIndex ? "done" : i === stepIndex ? "active" : "todo";
          return (
            <li className={`wizard-step ${state}`} key={step.id}>
              <span className="wizard-step-dot">{state === "done" ? <Check size={14} aria-hidden /> : i + 1}</span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>

      <div className="wizard-track" aria-hidden>
        <span style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="panel wizard-panel">
        {current === "profile" ? (
          <form className="wizard-body" onSubmit={saveProfile}>
            <MapPinned size={26} aria-hidden color="#31c46f" />
            <h2>Confirm your profile</h2>
            <p>These details come from your signed-in workspace.</p>
            {!canSaveProfile ? <StatusPill tone="blue">Managed by an owner or admin</StatusPill> : null}
            <label className="wizard-field">
              <span className="wizard-label">Agency name</span>
              <input
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                readOnly={!canSaveProfile}
                required
              />
            </label>
            <label className="wizard-field">
              <span className="wizard-label">Region</span>
              <input
                value={profileRegion}
                onChange={(event) => setProfileRegion(event.target.value)}
                readOnly={!canSaveProfile}
                required
              />
            </label>
            {message ? <p className={`wizard-status ${message.tone}`}>{message.text}</p> : null}
            <div className="wizard-actions">
              <button className="button secondary" disabled={busy} onClick={next} type="button">
                Skip for now
              </button>
              <button className="button" disabled={busy} type="submit">
                {canSaveProfile ? "Save and continue" : "Continue"} <ArrowRight size={16} aria-hidden />
              </button>
            </div>
          </form>
        ) : null}

        {current === "brand" ? (
          <form className="wizard-body" onSubmit={saveBrand}>
            <Palette size={26} aria-hidden color="#31c46f" />
            <h2>Add your brand</h2>
            <p>
              {canSaveBrand
                ? "Your colour and tone guide drafts. Logo uploads are stored with your brand assets for review."
                : "An owner, admin, or member can update brand assets. You can keep going with the current workspace defaults."}
            </p>
            {canSaveBrand ? (
              <>
                <label className="wizard-field">
                  <span className="wizard-label">Logo asset</span>
                  <span className="button secondary wizard-upload">
                    {logoFile ? `Selected: ${logoFile.name}` : "Upload logo"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      hidden
                      onChange={(event) => chooseLogo(event.target.files?.[0])}
                    />
                  </span>
                </label>
                <label className="wizard-field">
                  <span className="wizard-label">Brand colour</span>
                  <input
                    type="color"
                    className="wizard-color"
                    value={brandColor}
                    onChange={(event) => setBrandColor(event.target.value)}
                  />
                </label>
                <label className="wizard-field">
                  <span className="wizard-label">Tone</span>
                  <textarea value={brandTone} onChange={(event) => setBrandTone(event.target.value)} />
                </label>
              </>
            ) : (
              <div className="wizard-connect-row">
                <span>Brand defaults</span>
                <StatusPill tone="blue">Ready</StatusPill>
              </div>
            )}
            {message ? <p className={`wizard-status ${message.tone}`}>{message.text}</p> : null}
            <div className="wizard-actions">
              <button className="button secondary" disabled={busy} onClick={back} type="button">
                Back
              </button>
              <button className="button secondary" disabled={busy} onClick={next} type="button">
                Skip for now
              </button>
              <button className="button" disabled={busy} type="submit">
                {canSaveBrand ? "Save and continue" : "Continue"} <ArrowRight size={16} aria-hidden />
              </button>
            </div>
          </form>
        ) : null}

        {current === "connect" ? (
          <div className="wizard-body">
            <Link2 size={26} aria-hidden color="#31c46f" />
            <h2>Connect your ad accounts</h2>
            <p>
              {canManageConnections
                ? "Connect ad accounts when you are ready to publish. You can create ads before Meta is connected."
                : "An owner or admin can connect ad accounts later when the workspace is ready to publish."}
            </p>
            <div className="wizard-connect-row">
              <span>Meta</span>
              {canManageConnections ? (
                <Link className="button" href={metaConnectHref}>
                  Connect Meta
                </Link>
              ) : (
                <button className="button" disabled type="button">
                  Owner/admin only
                </button>
              )}
            </div>
            <div className="wizard-connect-row">
              <span>Google</span>
              {canManageConnections && googleAdsEnabled ? (
                <Link className="button secondary" href={googleConnectHref}>
                  Connect Google
                </Link>
              ) : (
                <button className="button secondary" disabled type="button">
                  {googleAdsEnabled ? "Owner/admin only" : "Not enabled yet"}
                </button>
              )}
            </div>
            <p className="wizard-skip-note">You can come back to connections from Settings.</p>
            {!canOpenCampaigns ? (
              <p className="wizard-skip-note">Ad creation is available when this workspace is enabled for self-serve.</p>
            ) : null}
            {message ? <p className={`wizard-status ${message.tone}`}>{message.text}</p> : null}
            <div className="wizard-actions">
              <button className="button secondary" disabled={busy} onClick={back} type="button">
                Back
              </button>
              <button className="button secondary" disabled={busy} onClick={() => void finishOnboarding()} type="button">
                Skip for now
              </button>
              <button className="button" disabled={busy} onClick={() => void finishOnboarding()} type="button">
                {busy ? "Finishing" : "Create first ad"} <ArrowRight size={16} aria-hidden />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
