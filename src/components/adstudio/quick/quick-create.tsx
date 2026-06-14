"use client";

import { ArrowRight, ChevronLeft, ImagePlus, Plus, RefreshCw, Sliders, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AD_STUDIO_TEMPLATES } from "@/lib/adstudio";
import type { AdStudioBrandKit, AdStudioCampaignPack, AdStudioTemplate, FirstAdInput } from "@/lib/adstudio";
import { isBuiltInAdStudioTemplate } from "@/lib/adstudio/templates.ts";
import { templatePreviewDataUrl } from "@/lib/adstudio/template-preview.ts";

import { uploadAdStudioMedia } from "../media-upload";
import { AdPreview, type PreviewFormat, type SelectedElement } from "../preview";
import { STYLES } from "../styles";
import { seedCopy } from "../use-copy";

import styles from "./quick-create.module.css";

type QuickCreateProps = {
  workspaceId: string;
  brandKit: AdStudioBrandKit;
  isSample?: boolean;
};

type Step = "gallery" | "compose" | "generating" | "result";
type Photo = { src: string; name: string };

const GENERATING_PHASES = ["Building your campaign…", "Writing the copy…", "Polishing each ad…"];

function cardHint(template: AdStudioTemplate): string {
  return template.preview?.headline || template.promptHint;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function parseLocation(raw: string, fallbackState: string): { suburb: string; city: string; state: string } {
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const suburb = parts[0] || raw.trim();
  let city = "";
  let state = fallbackState || "AU";
  if (parts[1]) {
    const tokens = parts[1].split(/\s+/).filter(Boolean);
    if (tokens.length) {
      state = tokens[tokens.length - 1];
      city = tokens.slice(0, -1).join(" ");
    }
  }
  return { suburb, city, state };
}

export function QuickCreate({ workspaceId, brandKit }: QuickCreateProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [templates, setTemplates] = useState<AdStudioTemplate[]>(AD_STUDIO_TEMPLATES);
  const [step, setStep] = useState<Step>("gallery");
  const [template, setTemplate] = useState<AdStudioTemplate | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [location, setLocation] = useState("");
  const [brief, setBrief] = useState("");
  const [pack, setPack] = useState<AdStudioCampaignPack | null>(null);
  const [variantIndex, setVariantIndex] = useState(0);
  const [format, setFormat] = useState<PreviewFormat>("story");
  const [selected, setSelected] = useState<SelectedElement>("headline");
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState("");

  const brand = brandKit.identity.businessName || "Your agency";
  const initials = brand.charAt(0).toUpperCase();
  const domain = hostOf(brandKit.source.url);

  // Load the workspace's approved template library; fall back to built-ins.
  useEffect(() => {
    let active = true;
    fetch(`/api/adstudio/template-library?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list = data?.templates as AdStudioTemplate[] | undefined;
        if (active && list && list.length) setTemplates(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [workspaceId]);

  // Rotate the honest phase label while the (blocking) generation runs.
  useEffect(() => {
    if (step !== "generating") return;
    setPhase(0);
    const id = window.setInterval(() => setPhase((p) => Math.min(p + 1, GENERATING_PHASES.length - 1)), 7000);
    return () => window.clearInterval(id);
  }, [step]);

  function openTemplate(next: AdStudioTemplate | null) {
    setTemplate(next);
    setError("");
    setStep("compose");
  }

  async function pickPhoto(file: File) {
    setError("");
    setUploading(true);
    try {
      const uploaded = await uploadAdStudioMedia({ file, workspaceId, brandKitId: brandKit.brandKitId });
      setPhoto({ src: uploaded.src, name: file.name });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload that photo.");
    } finally {
      setUploading(false);
    }
  }

  async function generate() {
    if (!photo) {
      setError("Add a listing photo first.");
      return;
    }
    if (!location.trim()) {
      setError("Add a suburb or address.");
      return;
    }
    setError("");
    setStep("generating");
    try {
      const market = parseLocation(location, brandKit.identity.marketRegion ?? "AU");
      const builtIn = template ? isBuiltInAdStudioTemplate(template.id) : false;
      const description =
        brief.trim() ||
        (template ? `${template.name} in ${market.suburb}.` : `Real estate ad for ${market.suburb}.`);
      const firstAd: FirstAdInput = {
        mode: template && builtIn ? "template" : "custom",
        source: template ? "template_library" : "blank",
        templateId: template && builtIn ? template.id : undefined,
        templateKey: template?.templateKey ?? template?.id,
        description: description.slice(0, 500),
        imageDataUrl: photo.src,
        formats: ["9:16", "4:5", "1:1"],
      };
      const response = await fetch("/api/adstudio/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstAd,
          goal: template?.goal ?? "seller_leads",
          offerId: template?.offerId ?? "seller_prep_checklist",
          suburb: market.suburb,
          city: market.city,
          state: market.state,
          platforms: ["meta"],
          creativeFormats: firstAd.formats,
          variantCount: 3,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? `Generation failed (${response.status}).`);
      setPack(payload.campaignPack as AdStudioCampaignPack);
      setVariantIndex(0);
      window.dispatchEvent(new Event("blockwise:trial-status-refresh"));
      setStep("result");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the ad.");
      setStep("compose");
    }
  }

  function reset() {
    setPack(null);
    setPhoto(null);
    setLocation("");
    setBrief("");
    setTemplate(null);
    setError("");
    setStep("gallery");
  }

  function openAdvanced() {
    const id = pack?.campaign.campaignId;
    router.push(id ? `/ad-studio?campaignId=${encodeURIComponent(id)}&advanced=1` : "/ad-studio?advanced=1");
  }

  // ---------------- Gallery ----------------
  if (step === "gallery") {
    return (
      <main className={styles.screen}>
        <header className={styles.topbar}>
          <button type="button" className={styles.iconBtn} aria-label="Back" onClick={() => router.push("/self-serve")}>
            <ChevronLeft aria-hidden size={22} />
          </button>
          <span className={styles.title}>Create ad</span>
          <button type="button" className={styles.advLink} onClick={openAdvanced}>
            Advanced
          </button>
        </header>
        <div className={styles.body}>
          <h1 className={styles.h1}>Start from a template</h1>
          <p className={styles.sub}>Shown in your brand — add a photo and the copy writes itself.</p>
          <div className={styles.grid}>
            {templates.map((tpl) => (
              <button key={tpl.id} type="button" className={styles.card} onClick={() => openTemplate(tpl)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.thumb} src={templatePreviewDataUrl(tpl, brandKit)} alt="" loading="lazy" />
                <span className={styles.cardName}>{tpl.name}</span>
                <span className={styles.cardHint}>{cardHint(tpl)}</span>
              </button>
            ))}
            <button type="button" className={`${styles.card} ${styles.blank}`} onClick={() => openTemplate(null)}>
              <span className={styles.blankThumb}>
                <Plus aria-hidden size={26} />
              </span>
              <span className={styles.cardName}>Start blank</span>
              <span className={styles.cardHint}>Describe it yourself</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ---------------- Compose ----------------
  if (step === "compose") {
    const ready = Boolean(photo) && location.trim().length > 0 && !uploading;
    return (
      <main className={styles.screen}>
        <header className={styles.topbar}>
          <button type="button" className={styles.iconBtn} aria-label="Back" onClick={() => setStep("gallery")}>
            <ChevronLeft aria-hidden size={22} />
          </button>
          <span className={styles.title}>{template ? `${template.name} ad` : "New ad"}</span>
          <span className={styles.advLink} aria-hidden />
        </header>

        <div className={styles.composeStage}>
          {template ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.composePreview} src={templatePreviewDataUrl(template, brandKit)} alt="" />
          ) : (
            <div className={styles.composeBlank}>Describe the ad you want below.</div>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pickPhoto(file);
            e.target.value = "";
          }}
        />

        <section className={styles.sheet}>
          <span className={styles.handle} aria-hidden />
          <button type="button" className={styles.photoTile} onClick={() => fileRef.current?.click()}>
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.photoThumb} src={photo.src} alt="" />
            ) : (
              <ImagePlus aria-hidden size={22} />
            )}
            <span>{uploading ? "Uploading…" : photo ? "Change photo" : "Listing photo"}</span>
          </button>

          <label className={styles.fieldLabel} htmlFor="qc-loc">
            Suburb or address
          </label>
          <input
            id="qc-loc"
            className={styles.field}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Scarborough, WA"
          />

          <label className={styles.fieldLabel} htmlFor="qc-brief">
            Anything to add? <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="qc-brief"
            className={styles.field}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={template?.promptHint ?? "Write a short prompt"}
            maxLength={500}
          />

          {error ? <p className={styles.error}>{error}</p> : null}

          <button type="button" className={styles.primary} disabled={!ready} onClick={() => void generate()}>
            Create ad
          </button>
          <p className={styles.helper}>Uses 1 ad pack · the AI writes the copy from your photo.</p>
        </section>
      </main>
    );
  }

  // ---------------- Generating ----------------
  if (step === "generating") {
    return (
      <main className={`${styles.screen} ${styles.center}`}>
        <div className={styles.spinner} aria-hidden />
        <p className={styles.genPhase} aria-live="polite">
          {GENERATING_PHASES[phase]}
        </p>
        <p className={styles.helper}>This takes about 20–40 seconds.</p>
      </main>
    );
  }

  // ---------------- Result ----------------
  const copy = pack ? seedCopy(pack, variantIndex) : null;
  return (
    <main className={`${styles.screen} ${styles.dark}`}>
      <header className={styles.topbar}>
        <button type="button" className={styles.iconBtnLight} aria-label="Close" onClick={reset}>
          <X aria-hidden size={22} />
        </button>
        <span className={`${styles.title} ${styles.titleLight}`}>Your ad</span>
        <span className={styles.advLink} aria-hidden />
      </header>

      {pack && copy ? (
        <>
          <div className="studio-mobile-preview-wrap">
            <div className={styles.stage}>
              <AdPreview
                brand={brand}
                domain={domain}
                initials={initials}
                copy={copy}
                image={photo?.src ?? ""}
                format={format}
                zoom={100}
                selectedElement={selected}
                setSelectedElement={setSelected}
              />
            </div>
          </div>

          <div className={styles.formatRow}>
            {(["story", "feed", "square"] as PreviewFormat[]).map((f) => (
              <button
                key={f}
                type="button"
                className={format === f ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                onClick={() => setFormat(f)}
              >
                {f === "story" ? "Story" : f === "feed" ? "Feed" : "Square"}
              </button>
            ))}
          </div>

          <div className={styles.variantRow}>
            {pack.variants.map((v, i) => (
              <button
                key={v.variantId}
                type="button"
                className={variantIndex === i ? `${styles.variant} ${styles.variantOn}` : styles.variant}
                onClick={() => setVariantIndex(i)}
              >
                Ad {i + 1}
              </button>
            ))}
          </div>

          <div className={styles.resultActions}>
            <button type="button" className={styles.ghostDark} onClick={() => void generate()}>
              <RefreshCw aria-hidden size={16} /> Regenerate
            </button>
            <button type="button" className={styles.launch} onClick={openAdvanced}>
              <Sliders aria-hidden size={16} /> Edit &amp; publish
              <ArrowRight aria-hidden size={16} />
            </button>
          </div>
          <button type="button" className={styles.makeAnother} onClick={reset}>
            Make another
          </button>
        </>
      ) : null}

      <style>{STYLES}</style>
    </main>
  );
}
