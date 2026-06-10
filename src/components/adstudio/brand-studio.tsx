"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AssetUploadDropzone } from "@/components/asset-upload-dropzone";
import type { AdStudioBrandKit } from "@/lib/adstudio";
import { mediaUrlForStoragePath } from "@/lib/adstudio/assets";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  LOGO_MAX_BYTES,
  LOGO_UPLOAD_TYPES,
  readFileAsDataUrl,
  sanitizeUploadFileName,
  validateAssetUploadFile,
} from "@/lib/upload/asset-file";

import { ColorSwatch } from "./brand-color-swatch";
import { BrandDetailsCards } from "./brand-details-cards";
import { LogoProofStrip, PreviewRail } from "./brand-preview";
import { BRAND_STYLES } from "./brand-studio-styles";
import { VoiceToneCard } from "./brand-voice-card";

type ColourKey = "primary" | "secondary" | "accent" | "background" | "text";

const COLOUR_LABELS: Array<{ key: ColourKey; label: string }> = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "accent", label: "Accent" },
  { key: "background", label: "Background" },
  { key: "text", label: "Text" },
];

export function BrandStudio({ brandKit: initialKit }: { brandKit: AdStudioBrandKit }) {
  const [kit, setKit] = useState(initialKit);
  const [openSwatch, setOpenSwatch] = useState<ColourKey | null>(null);
  const [scanUrl, setScanUrl] = useState(() => initialKit.source.url.replace(/^https?:\/\//, ""));
  const [busy, setBusy] = useState<"" | "scan" | "save" | "approve">("");
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(initialKit.logos.primaryLogoUrl ?? "");
  const headlineSample = "What's your home worth in today's market?";

  useEffect(() => {
    function close() {
      setOpenSwatch(null);
    }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  function flash(tone: "ok" | "err", text: string) {
    setNotice({ tone, text });
    window.setTimeout(() => setNotice(null), 3200);
  }

  const sitePalette = useMemo(
    () =>
      [kit.colours.primary, kit.colours.secondary, kit.colours.accent, kit.colours.background, kit.colours.text].filter(
        (c): c is string => Boolean(c),
      ),
    [kit.colours],
  );

  function setColour(key: ColourKey, hex: string) {
    setKit((current) => ({ ...current, colours: { ...current.colours, [key]: hex } }));
  }

  function setIdentity<K extends keyof AdStudioBrandKit["identity"]>(key: K, value: AdStudioBrandKit["identity"][K]) {
    setKit((current) => ({ ...current, identity: { ...current.identity, [key]: value } }));
  }

  function setContact<K extends keyof AdStudioBrandKit["contact"]>(key: K, value: AdStudioBrandKit["contact"][K]) {
    setKit((current) => ({ ...current, contact: { ...current.contact, [key]: value } }));
  }

  function setTone<K extends keyof AdStudioBrandKit["tone"]>(key: K, value: AdStudioBrandKit["tone"][K]) {
    setKit((current) => ({ ...current, tone: { ...current.tone, [key]: value } }));
  }

  function setDisclaimer(index: number, value: string) {
    setKit((current) => {
      const disclaimers = [...current.compliance.disclaimers];
      disclaimers[index] = value;
      return { ...current, compliance: { ...current.compliance, disclaimers } };
    });
  }

  function addDisclaimer() {
    setKit((c) => ({
      ...c,
      compliance: { ...c.compliance, disclaimers: [...c.compliance.disclaimers, ""] },
    }));
  }

  async function chooseLogo(file: File) {
    const previewUrl = await readFileAsDataUrl(file);
    setLogoFile(file);
    setLogoPreviewUrl(previewUrl);
    flash("ok", "Logo ready to save.");
  }

  async function uploadLogoAsset(file: File): Promise<string> {
    const supabase = createSupabaseBrowserClient();
    const safeName = sanitizeUploadFileName(file.name);
    const storagePath = `${kit.workspaceId}/brand/${kit.brandKitId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("workspace-artifacts").upload(storagePath, file);

    if (uploadError) throw new Error("We couldn't upload that logo. Try another file.");

    const response = await fetch(`/api/adstudio/brand-kits/${kit.brandKitId}/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetType: "logo",
        storagePath,
        fileName: file.name,
        contentType: file.type,
        size: file.size,
      }),
    });

    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error || "We uploaded the logo but couldn't attach it to your brand.");
    }

    const mediaUrl = mediaUrlForStoragePath(kit.workspaceId, storagePath);
    if (!mediaUrl) throw new Error("We couldn't prepare that logo URL.");
    return mediaUrl;
  }

  async function scanSite() {
    if (busy) return;
    const websiteUrl = scanUrl.trim();
    if (!websiteUrl) {
      flash("err", "Enter your website address first.");
      return;
    }
    setBusy("scan");
    try {
      const res = await fetch("/api/adstudio/brand-kits/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl }),
      });
      const json = (await res.json().catch(() => ({}))) as { brandKit?: AdStudioBrandKit; error?: string };
      if (!res.ok || !json.brandKit) throw new Error(json.error || `Scan failed (${res.status})`);
      setKit(json.brandKit);
      setScanUrl(json.brandKit.source.url.replace(/^https?:\/\//, ""));
      flash("ok", "Scan complete — kit updated from your site.");
    } catch (error) {
      flash("err", error instanceof Error ? error.message : "Could not scan the site.");
    } finally {
      setBusy("");
    }
  }

  async function saveKit(nextStatus?: "approved") {
    if (busy) return;
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
      setLogoPreviewUrl(kit.logos.primaryLogoUrl ?? "");
      flash("err", logoError);
      return;
    }

    const logoToUpload = logoFile;
    setBusy(nextStatus ? "approve" : "save");
    try {
      const uploadedLogoUrl = logoToUpload ? await uploadLogoAsset(logoToUpload) : null;
      const nextLogos = uploadedLogoUrl
        ? { ...kit.logos, primaryLogoUrl: uploadedLogoUrl }
        : kit.logos;
      const res = await fetch(`/api/adstudio/brand-kits/${kit.brandKitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: kit.identity.businessName,
          source_url: /^https?:\/\//.test(scanUrl) ? scanUrl : `https://${scanUrl}`,
          market_region: kit.identity.marketRegion,
          identity_json: kit.identity,
          logos_json: nextLogos,
          colours_json: kit.colours,
          typography_json: kit.typography,
          tone_json: kit.tone,
          contact_json: kit.contact,
          compliance_json: kit.compliance,
          ...(nextStatus ? { review_status: nextStatus } : {}),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || `Save failed (${res.status})`);
      }
      if (uploadedLogoUrl) {
        setKit((current) => ({ ...current, logos: { ...current.logos, primaryLogoUrl: uploadedLogoUrl } }));
        setLogoPreviewUrl(uploadedLogoUrl);
        setLogoFile(null);
      }
      if (nextStatus) {
        setKit((current) => ({ ...current, reviewStatus: "approved" }));
        flash("ok", logoToUpload ? "Brand kit approved - logo saved." : "Brand kit approved - it now guards every ad.");
      } else {
        flash("ok", logoToUpload ? "Saved with logo." : "Saved.");
      }
    } catch (error) {
      flash("err", error instanceof Error ? error.message : "Could not save the kit.");
    } finally {
      setBusy("");
    }
  }

  const brandName = kit.identity.businessName || "Your brand";
  const initial = brandName.charAt(0).toUpperCase();
  const voiceLine = (kit.tone.voice || "").split(".")[0];
  const approved = kit.reviewStatus === "approved";
  const logoDisplayName = logoFile?.name ?? (logoPreviewUrl ? "Primary logo" : undefined);

  return (
    <main className="bs-screen" aria-label="Brand Studio">
      <style>{BRAND_STYLES}</style>

      <div className="bs-top">
        <Link href="/ad-studio" className="back">
          ‹ Ad Studio
        </Link>
        <h1>Brand Studio</h1>
        <span className={`chip ${approved ? "good" : "warn"}`}>{approved ? "✓ Approved" : "Pending review"}</span>
        <div className="grow">
          {notice && <span className={`notice ${notice.tone}`}>{notice.text}</span>}
          <button className="btn sec" type="button" disabled={busy !== ""} onClick={() => void saveKit()}>
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
          <button className="btn pri" type="button" disabled={busy !== ""} onClick={() => void saveKit("approved")}>
            {busy === "approve" ? "Approving…" : "✓ Approve kit"}
          </button>
        </div>
      </div>

      <div className="bs-scroll">
        <div className="bs-hero">
          <div className="kick">Brand kit · Real estate · {kit.identity.marketRegion ?? "AU"}</div>
          <h2>
            <input
              value={kit.identity.businessName}
              aria-label="Agency name"
              onChange={(event) => setIdentity("businessName", event.target.value)}
            />
          </h2>
          <div className="scanline">
            <span className="url">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9s1.3-6.4 3.8-9z" />
              </svg>
              <input value={scanUrl} aria-label="Website" onChange={(event) => setScanUrl(event.target.value)} />
            </span>
            <button type="button" className="go" disabled={busy !== ""} onClick={() => void scanSite()}>
              {busy === "scan" ? "Scanning…" : "↻ Re-scan site"}
            </button>
          </div>
        </div>

        <LogoProofStrip
          logoPreviewUrl={logoPreviewUrl}
          initial={initial}
          brandName={brandName}
          primaryColour={kit.colours.primary}
        />

        <div className="bs-body">
          <div className="bs-main">
            <section className="bs-card">
              <h3>Logo</h3>
              <AssetUploadDropzone
                className="bs-logo-upload"
                label="Upload logo"
                actionText="Upload logo"
                helperText="PNG, JPG, WebP, or SVG / up to 5 MB"
                previewUrl={logoPreviewUrl}
                previewAlt=""
                fileName={logoDisplayName}
                fileSize={logoFile?.size}
                fileType={logoFile?.type}
                acceptedTypes={LOGO_UPLOAD_TYPES}
                maxBytes={LOGO_MAX_BYTES}
                typeError="Upload a PNG, JPG, WebP, or SVG logo under 5 MB."
                sizeError="Upload a PNG, JPG, WebP, or SVG logo under 5 MB."
                capturePagePaste
                disabled={busy !== ""}
                onFileAccepted={chooseLogo}
                onFileRejected={(message) => flash("err", message)}
                onClear={
                  logoFile
                    ? () => {
                        setLogoFile(null);
                        setLogoPreviewUrl(kit.logos.primaryLogoUrl ?? "");
                      }
                    : undefined
                }
              />
            </section>

            <section className="bs-card">
              <h3>Colours</h3>
              <div className="bs-swrow">
                {COLOUR_LABELS.map(({ key, label }) => (
                  <ColorSwatch
                    key={key}
                    label={label}
                    value={kit.colours[key] || "#888888"}
                    sitePalette={sitePalette}
                    open={openSwatch === key}
                    onOpen={() => setOpenSwatch(key)}
                    onClose={() => setOpenSwatch(null)}
                    onChange={(hex) => setColour(key, hex)}
                  />
                ))}
              </div>
              <span className="subtle">Click a swatch to change it — the preview updates as you pick.</span>
            </section>

            <section className="bs-card">
              <h3>Typography</h3>
              <div className="bs-spec">
                <div className="aa">Aa</div>
                <div className="rows">
                  <div>
                    <small>
                      Headings ·{" "}
                      <input
                        className="font-name"
                        value={kit.typography.headingFont}
                        aria-label="Heading font"
                        onChange={(event) =>
                          setKit((c) => ({ ...c, typography: { ...c.typography, headingFont: event.target.value } }))
                        }
                      />
                    </small>
                    <span className="h-sample">{headlineSample}</span>
                  </div>
                  <div>
                    <small>
                      Body ·{" "}
                      <input
                        className="font-name"
                        value={kit.typography.bodyFont}
                        aria-label="Body font"
                        onChange={(event) =>
                          setKit((c) => ({ ...c, typography: { ...c.typography, bodyFont: event.target.value } }))
                        }
                      />
                    </small>
                    <span className="b-sample">
                      Local sales are setting new benchmarks. Get a free, no-pressure appraisal.
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <VoiceToneCard tone={kit.tone} onToneChange={setTone} />

            <BrandDetailsCards
              identity={kit.identity}
              contact={kit.contact}
              disclaimers={kit.compliance.disclaimers}
              onIdentityChange={setIdentity}
              onContactChange={setContact}
              onDisclaimerChange={setDisclaimer}
              onAddDisclaimer={addDisclaimer}
            />
          </div>

          <PreviewRail
            brandName={brandName}
            initial={initial}
            headline={headlineSample}
            voiceLine={voiceLine}
            primaryColour={kit.colours.primary}
            secondaryColour={kit.colours.secondary}
          />
        </div>
      </div>
    </main>
  );
}
