"use client";

import {
  Download,
  Image as ImageIcon,
  Pencil,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioOfferTemplate,
} from "@/lib/adstudio";

type AdStudioWorkbenchProps = {
  brandKit: AdStudioBrandKit;
  campaignPack: AdStudioCampaignPack;
  offers: AdStudioOfferTemplate[];
  performance: {
    leads: number;
    costPerLeadAud: number;
    bookedAppraisals: number;
    bestFormat: string;
    recommendations: string[];
  };
};

type Mode = "ai" | "assist" | "manual";
type FormatId =
  | "feed-1x1"
  | "feed-4x5"
  | "story-9x16"
  | "land-191";
type FieldKey = "primary" | "headline" | "body" | "cta";

type CopyState = Record<FieldKey, string>;

type Fx = {
  bright: number;
  contrast: number;
  sat: number;
  warm: number;
  zoom: number;
};

type ImageState = { src?: string; gen?: boolean } | null;

const MODES: Record<Mode, { label: string; helper: string; btn: string }> = {
  ai: {
    label: "AI generated",
    helper: "Describe the ad and AI builds the image and copy for you.",
    btn: "Generate complete ad",
  },
  assist: {
    label: "AI helps",
    helper: "You steer; AI drafts options and rewrites copy. Edit anything on the right.",
    btn: "Draft 3 directions",
  },
  manual: {
    label: "Create your own",
    helper: "Add your image on the left, write your copy on the right.",
    btn: "Ask AI for help",
  },
};

const PLACEMENTS: Array<{ id: FormatId; lbl: string; sub: string }> = [
  { id: "feed-1x1", lbl: "1:1", sub: "Square" },
  { id: "feed-4x5", lbl: "4:5", sub: "Feed" },
  { id: "story-9x16", lbl: "9:16", sub: "Story" },
  { id: "land-191", lbl: "1.91", sub: "Link" },
];

type FormatMeta = {
  kind: "feed" | "story" | "land";
  spec: string;
  w: number;
  ar: string;
  ctr: string;
  cpc: string;
  cpl: string;
  aspect: string;
};

const FMT: Record<FormatId, FormatMeta> = {
  "feed-1x1": { kind: "feed", spec: "1080×1080 · square", w: 340, ar: "1 / 1", ctr: "4.3%", cpc: "A$0.24", cpl: "A$49", aspect: "1:1" },
  "feed-4x5": { kind: "feed", spec: "1080×1350 · recommended for Feed", w: 340, ar: "4 / 5", ctr: "5.5%", cpc: "A$0.24", cpl: "A$49", aspect: "4:5" },
  "story-9x16": { kind: "story", spec: "1080×1920 · full screen", w: 250, ar: "9 / 16", ctr: "4.7%", cpc: "A$0.26", cpl: "A$52", aspect: "9:16" },
  "land-191": { kind: "land", spec: "1200×628 · landscape", w: 470, ar: "1.91 / 1", ctr: "3.9%", cpc: "A$0.25", cpl: "A$55", aspect: "1.91:1" },
};

const LIMITS: Record<FieldKey, number> = {
  headline: 40,
  primary: 125,
  body: 30,
  cta: 20,
};

const FIELDSETS: Record<FormatMeta["kind"], Array<[FieldKey, string]>> = {
  feed: [["primary", "Primary text"], ["headline", "Headline"], ["body", "Description"], ["cta", "Button"]],
  land: [["primary", "Primary text"], ["headline", "Headline"], ["body", "Description"], ["cta", "Button"]],
  story: [["headline", "Headline"], ["body", "Body"], ["cta", "CTA sticker"]],
};

const CTA_LABELS: Record<string, string> = {
  LEARN_MORE: "Learn more",
  SIGN_UP: "Sign up",
  DOWNLOAD: "Download",
  CONTACT_US: "Contact us",
};

const DEFAULT_FX: Fx = { bright: 100, contrast: 100, sat: 100, warm: 0, zoom: 100 };

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

function seedCopy(pack: AdStudioCampaignPack): CopyState {
  const cp = pack.copyPacks[0];
  const meta = cp?.meta;
  return {
    primary: meta?.primaryText?.[0] ?? "",
    headline: meta?.headlines?.[0] ?? pack.variants[0]?.headline ?? "",
    body: meta?.descriptions?.[0] ?? "",
    cta: CTA_LABELS[meta?.cta ?? "LEARN_MORE"] ?? "Learn more",
  };
}

export function AdStudioWorkbench({
  brandKit,
  campaignPack: initialPack,
  offers,
  performance,
}: AdStudioWorkbenchProps) {
  const [mode, setMode] = useState<Mode>("assist");
  const [showModeScreen, setShowModeScreen] = useState(true);
  const [format, setFormat] = useState<FormatId>("feed-4x5");
  const [pack, setPack] = useState(initialPack);
  const [copy, setCopy] = useState<CopyState>(() => seedCopy(initialPack));
  const [selectedOfferId, setSelectedOfferId] = useState(offers[0]?.offerId ?? "");
  const [selected, setSelected] = useState<FieldKey | "image" | null>(null);
  const [image, setImage] = useState<ImageState>(null);
  const [fx, setFx] = useState<Fx>(DEFAULT_FX);
  const [accent, setAccent] = useState(brandKit.colours.primary || "#087f7a");
  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState("Generating…");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(
    `${offers[0]?.name ?? "Free appraisal"} for ${initialPack.campaign.market.suburb} homeowners. Premium, direct and transparent — use real local proof, no over-claiming.`,
  );
  const [variantCursor, setVariantCursor] = useState(0);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const brand = brandKit.identity.businessName || "Northstar Realty";
  const domain = hostOf(brandKit.source.url);
  const meta = FMT[format];
  const accentColours = useMemo(() => {
    const c = brandKit.colours;
    return [c.primary, c.secondary, c.accent, c.text].filter(Boolean);
  }, [brandKit.colours]);

  function toast(message: string) {
    setToastMsg(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2200);
  }

  function setField(key: FieldKey, value: string) {
    setCopy((c) => ({ ...c, [key]: value }));
  }

  function selectField(key: FieldKey | "image") {
    setSelected(key);
    if (key !== "image") {
      const el = document.getElementById(`ef_${key}`);
      el?.focus();
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function chooseMode(next: Mode) {
    setMode(next);
    setShowModeScreen(false);
    toast(`${MODES[next].label} mode`);
  }

  function applyVariant(index: number) {
    const v = pack.variants[index];
    if (!v) return;
    setCopy((c) => ({ ...c, headline: v.headline, primary: v.offer || c.primary, cta: v.cta || c.cta }));
    toast("Applied to ad");
  }

  function fxStyle(): React.CSSProperties {
    return {
      filter: `brightness(${fx.bright}%) contrast(${fx.contrast}%) saturate(${fx.sat}%) sepia(${fx.warm}%)`,
      transform: `scale(${fx.zoom / 100})`,
    };
  }

  async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error ?? `Request failed with ${response.status}.`);
    }
    return payload as T;
  }

  function imagePrompt(): string {
    const offer = offers.find((o) => o.offerId === selectedOfferId)?.name ?? "ad";
    return `${prompt} Real-estate scene for a ${offer} ad.`;
  }

  async function generateCopyAndPack() {
    setBusy(true);
    setBusyMsg("Generating campaign with AI…");
    try {
      const payload = await postJson<{ campaignPack: AdStudioCampaignPack }>("/api/adstudio/campaigns", {
        brandKit,
        goal: "seller_leads",
        suburb: pack.campaign.market.suburb,
        city: pack.campaign.market.city,
        state: pack.campaign.market.state,
        offerId: selectedOfferId || "seller_prep_checklist",
        platforms: ["meta"],
        variantCount: 5,
      });
      setPack(payload.campaignPack);
      setCopy(seedCopy(payload.campaignPack));
      setVariantCursor(0);
      toast("Ad generated — edit anything on the right");
    } catch (error) {
      toast(getMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function generateImage(editPrompt?: string) {
    setBusy(true);
    setBusyMsg(editPrompt ? "Applying AI image change…" : "Generating image with AI…");
    try {
      const payload = await postJson<{ image: string }>("/api/adstudio/generate-image", {
        prompt: editPrompt ? `${imagePrompt()} ${editPrompt}` : imagePrompt(),
        aspectRatio: meta.aspect,
      });
      setImage({ src: payload.image, gen: true });
      setFx(DEFAULT_FX);
      toast(editPrompt ? "AI image change applied" : "Image generated");
    } catch (error) {
      toast(getMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function onPrimaryAction() {
    if (mode === "manual") {
      toast("Write your copy on the right, add an image on the left.");
      return;
    }
    await generateCopyAndPack();
  }

  function rewriteField(key: FieldKey) {
    const next = (variantCursor + 1) % Math.max(pack.variants.length, 1);
    const v = pack.variants[next];
    setVariantCursor(next);
    if (!v) {
      toast("No more variants to draw from");
      return;
    }
    if (key === "headline") setField("headline", v.headline);
    else if (key === "primary") setField("primary", v.offer || copy.primary);
    else if (key === "cta") setField("cta", v.cta || copy.cta);
    else setField(key, `${copy[key]}`.trim());
    toast("Rewritten from next variant");
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        setImage({ src: String(event.target?.result ?? "") });
        setFx(DEFAULT_FX);
        toast("Image applied to ad");
      };
      reader.readAsDataURL(file);
    });
  }

  async function exportPack() {
    setBusy(true);
    setBusyMsg("Building export ZIP…");
    try {
      const response = await fetch(`/api/adstudio/export-packages/${pack.campaign.campaignId}/download`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignPack: pack }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Export failed." }));
        throw new Error(payload.error ?? "Export failed.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${pack.campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-adstudio.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast("Export ZIP downloaded");
    } catch (error) {
      toast(getMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const fields = FIELDSETS[meta.kind];
  const initials = brand.charAt(0).toUpperCase();

  const imageNode = (className: string) => {
    if (image?.src) return <img className={className} src={image.src} style={fxStyle()} alt="" />;
    return (
      <div className="as2-vis-ph">
        <ImageIcon aria-hidden size={26} />
        Add or generate an image on the left — it appears here exactly as it will publish.
      </div>
    );
  };

  const Layer = ({
    field,
    className,
    children,
    style,
  }: {
    field: FieldKey | "image";
    className?: string;
    children?: React.ReactNode;
    style?: React.CSSProperties;
  }) => (
    <div
      className={`as2-layer ${className ?? ""} ${selected === field ? "sel" : ""}`}
      style={style}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        selectField(field);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectField(field);
        }
      }}
    >
      {children}
    </div>
  );

  return (
    <div className="as2">
      <style>{STYLES}</style>

      <div className="as2-topbar">
        <div className="as2-brandline">
          <span className="as2-wordmark">{brand}</span>
          <span className="as2-vline" />
          <span className="as2-mode-pill">
            {MODES[mode].label}
            <button type="button" onClick={() => setShowModeScreen(true)}>
              Change
            </button>
          </span>
        </div>
        <div className="as2-top-actions">
          <span className="as2-provider">
            <span className="as2-dot" />
            Engine: OpenAI · gpt-image-1
          </span>
          <button className="as2-btn primary" type="button" onClick={exportPack}>
            <Download aria-hidden size={15} />
            Export pack
          </button>
        </div>
      </div>

      <div className="as2-work">
        <aside className="as2-pane left">
          <div className="as2-pane-hd">
            <div>
              <div className="as2-label">Set up</div>
              <h2>Brief &amp; assets</h2>
            </div>
          </div>
          <div className="as2-pane-body">
            <p className="as2-helper">{MODES[mode].helper}</p>
            <textarea
              className="as2-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <button
              className={`as2-btn block ${mode === "manual" ? "" : "accent"}`}
              type="button"
              disabled={busy}
              onClick={onPrimaryAction}
            >
              <Sparkles aria-hidden size={15} />
              {MODES[mode].btn}
            </button>

            <div>
              <div className="as2-mini-label">Seller offer</div>
              <div className="as2-quickstarts">
                {offers.map((offer) => (
                  <button
                    key={offer.offerId}
                    type="button"
                    className={`as2-qs ${selectedOfferId === offer.offerId ? "sel" : ""}`}
                    onClick={() => {
                      setSelectedOfferId(offer.offerId);
                      toast(`${offer.name} selected`);
                    }}
                  >
                    <span className="as2-qs-ic">
                      <Sparkles aria-hidden size={15} />
                    </span>
                    <span>
                      <span className="as2-qs-t">{offer.name}</span>
                      <span className="as2-qs-d">{offer.expectedLeadIntent}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="as2-mini-label">Image</div>
              <button className="as2-btn block" type="button" disabled={busy} onClick={() => generateImage()}>
                <Sparkles aria-hidden size={15} />
                Generate image with AI
              </button>
              <button className="as2-dropzone" type="button" onClick={() => fileInput.current?.click()}>
                <ImageIcon aria-hidden size={20} />
                <div className="as2-dz-t">Click to upload</div>
                <div className="as2-sm">PNG, JPG</div>
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>

            <details className="as2-acc" open>
              <summary>
                Expected performance <span className="as2-chev">›</span>
              </summary>
              <div className="as2-acc-body">
                <div className="as2-kpis">
                  <div className="as2-kpi">
                    <div className="v">{meta.ctr}</div>
                    <div className="k">CTR</div>
                  </div>
                  <div className="as2-kpi">
                    <div className="v">{meta.cpc}</div>
                    <div className="k">CPC</div>
                  </div>
                  <div className="as2-kpi">
                    <div className="v">{meta.cpl}</div>
                    <div className="k">CPL</div>
                  </div>
                </div>
                <p className="as2-helper">
                  {performance.leads} leads · A${performance.costPerLeadAud}/lead · best format {performance.bestFormat}. AU benchmark, directional only.
                </p>
              </div>
            </details>

            <details className="as2-acc">
              <summary>
                Compliance <span className="as2-chev">›</span>
              </summary>
              <div className="as2-acc-body">
                {pack.compliance.issues.length === 0 ? (
                  <div className="as2-gate ok">
                    <span className="as2-gate-dot">✓</span>
                    <div>
                      <b>No issues found</b>
                      <div className="as2-sm">Compliance review passed for this pack.</div>
                    </div>
                  </div>
                ) : (
                  pack.compliance.issues.map((issue) => (
                    <div className={`as2-gate ${issue.severity === "blocking" ? "warn" : "ok"}`} key={issue.code}>
                      <span className="as2-gate-dot">{issue.severity === "blocking" ? "!" : "✓"}</span>
                      <div>
                        <b>{issue.code.replace(/_/g, " ")}</b>
                        <div className="as2-sm">{issue.message}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </details>

            <details className="as2-acc">
              <summary>
                Brand <span className="as2-chev">›</span>
              </summary>
              <div className="as2-acc-body">
                <div className="as2-row">
                  <span className="as2-sm as2-muted">Accent colour</span>
                  <div className="as2-swatches">
                    {accentColours.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`as2-sw ${accent === c ? "sel" : ""}`}
                        style={{ background: c }}
                        onClick={() => {
                          setAccent(c);
                          toast("Accent updated");
                        }}
                        aria-label={`Use ${c}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </details>
          </div>
        </aside>

        {/* CENTER */}
        <div className="as2-center">
          <div className="as2-canvas-head">
            <div className="as2-plat">
              <button
                type="button"
                className="active"
                onClick={() => {
                  setFormat("feed-4x5");
                  setSelected(null);
                }}
              >
                Meta
              </button>
            </div>
            <div className="as2-seg">
              {PLACEMENTS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={format === p.id ? "active" : ""}
                  onClick={() => {
                    setFormat(p.id);
                    setSelected(null);
                  }}
                >
                  {p.lbl}
                  <span className="sub">{p.sub}</span>
                </button>
              ))}
            </div>
            <span className="as2-placement-name">{meta.spec}</span>
          </div>

          <div className="as2-stage">
            <div className="as2-edit-hint">Click any part of the ad to edit it on the right</div>

            {(meta.kind === "feed" || meta.kind === "land") && (
              <div className="as2-device">
                <div className={meta.kind === "feed" ? "as2-feed-card" : "as2-land-card"} style={{ ["--w" as string]: `${meta.w}px` }}>
                  <div className="as2-fc-top">
                    <div className="as2-fc-id">
                      <span className="as2-fc-av" style={{ background: accent }}>{initials}</span>
                      <div>
                        <div className="as2-fc-name">{brand}</div>
                        <div className="as2-fc-sub">Sponsored</div>
                      </div>
                    </div>
                    <span className="as2-fc-dots">···</span>
                  </div>
                  <Layer field="primary" className="as2-fc-primary">{copy.primary}</Layer>
                  <Layer field="image" className="as2-fc-visual" style={{ ["--ar" as string]: meta.ar }}>
                    {imageNode("as2-vis-img")}
                  </Layer>
                  <div className="as2-fc-link">
                    <div>
                      <div className="as2-fc-domain">{domain}</div>
                      <Layer field="headline" className="as2-fc-headline">{copy.headline}</Layer>
                      <Layer field="body" className="as2-fc-desc">{copy.body}</Layer>
                    </div>
                    <Layer field="cta" className="as2-fc-cta" style={{ background: accent }}>{copy.cta}</Layer>
                  </div>
                </div>
              </div>
            )}

            {meta.kind === "story" && (
              <div className="as2-device">
                <div className="as2-story" style={{ ["--w" as string]: `${meta.w}px` }}>
                  {image?.src ? (
                    <img className="as2-story-img" src={image.src} style={fxStyle()} alt="" />
                  ) : (
                    <div className="as2-story-img as2-story-fallback" />
                  )}
                  <div className="as2-story-grad" />
                  <div className="as2-story-top">
                    <span className="as2-story-av" style={{ borderColor: "#fff" }}>{initials}</span>
                    <div>
                      <div className="as2-story-name">{brand}</div>
                      <div className="as2-story-sub">Sponsored</div>
                    </div>
                  </div>
                  <Layer field="image" style={{ position: "absolute", inset: 0, zIndex: 2 }} />
                  <div className="as2-story-content">
                    <Layer field="headline" className="as2-story-headline">{copy.headline}</Layer>
                    <Layer field="body" className="as2-story-body">{copy.body}</Layer>
                  </div>
                  <Layer field="cta" className="as2-story-cta">{copy.cta}</Layer>
                </div>
              </div>
            )}

            {busy && (
              <div className="as2-gen-loading">
                <div className="as2-gen-card">
                  <div className="as2-spinner" />
                  <div className="as2-gen-msg">{busyMsg}</div>
                  <div className="as2-bar"><i /></div>
                  <div className="as2-sm as2-muted">Live output — not a placeholder render.</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="as2-pane right">
          <div className="as2-pane-hd">
            <div>
              <div className="as2-label">Edit</div>
              <h2>Copy &amp; image</h2>
            </div>
          </div>
          <div className="as2-pane-body">
            <div className="as2-mini-label">Edit copy</div>
            <div className="as2-copy-fields">
              {fields.map(([key, label]) => {
                const value = copy[key];
                const limit = LIMITS[key];
                return (
                  <div className={`as2-efield ${selected === key ? "flash" : ""}`} key={key}>
                    <div className="as2-efield-h">
                      <span className="as2-mini-label">{label}</span>
                      <span className="as2-ef-right">
                        <button className="as2-rw" type="button" title="AI rewrite" onClick={() => rewriteField(key)}>
                          <Wand2 aria-hidden size={12} />
                        </button>
                        <span className={`as2-counter ${value.length > limit ? "over" : ""}`}>
                          {value.length} / {limit}
                        </span>
                      </span>
                    </div>
                    <textarea
                      id={`ef_${key}`}
                      className="as2-ef"
                      rows={2}
                      value={value}
                      onFocus={() => setSelected(key)}
                      onChange={(e) => setField(key, e.target.value)}
                    />
                  </div>
                );
              })}
            </div>

            {pack.variants.length > 0 && (
              <details className="as2-acc">
                <summary>
                  Variants ({pack.variants.length}) <span className="as2-chev">›</span>
                </summary>
                <div className="as2-acc-body">
                  {pack.variants.map((v, i) => (
                    <button key={v.variantId} type="button" className="as2-variant" onClick={() => applyVariant(i)}>
                      <div className="v-h">{v.headline}</div>
                      <div className="v-b">{v.offer}</div>
                    </button>
                  ))}
                </div>
              </details>
            )}

            <details className="as2-acc" open={selected === "image"}>
              <summary>
                Edit image <span className="as2-chev">›</span>
              </summary>
              <div className="as2-acc-body">
                <div className="as2-row">
                  <span className="as2-sm as2-muted">
                    {!image ? "no image yet" : image.gen ? "AI generated" : "uploaded"}
                  </span>
                  <button className="as2-btn ghost sm" type="button" onClick={() => setFx(DEFAULT_FX)}>
                    Reset
                  </button>
                </div>
                <FxSlider label="Brightness" min={50} max={150} value={fx.bright} suffix="%" onChange={(v) => setFx((f) => ({ ...f, bright: v }))} />
                <FxSlider label="Contrast" min={50} max={150} value={fx.contrast} suffix="%" onChange={(v) => setFx((f) => ({ ...f, contrast: v }))} />
                <FxSlider label="Saturation" min={0} max={200} value={fx.sat} suffix="%" onChange={(v) => setFx((f) => ({ ...f, sat: v }))} />
                <FxSlider label="Warmth" min={0} max={80} value={fx.warm} suffix="%" onChange={(v) => setFx((f) => ({ ...f, warm: v }))} />
                <FxSlider label="Zoom / crop" min={100} max={180} value={fx.zoom} suffix="%" onChange={(v) => setFx((f) => ({ ...f, zoom: v }))} />
                <AiEditRow disabled={busy || !image?.src} onRun={(p) => generateImage(p)} />
              </div>
            </details>
          </div>
        </aside>
      </div>

      {showModeScreen && (
        <div className="as2-modescreen">
          <div className="as2-ms-wrap">
            <div className="as2-ms-logo" style={{ background: accent }}>{initials}</div>
            <h1>How do you want to build this ad?</h1>
            <p className="as2-ms-sub">For homeowners thinking about selling. Pick a starting point — you can change anything later.</p>
            <div className="as2-modes">
              {(Object.keys(MODES) as Mode[]).map((m, i) => (
                <button
                  key={m}
                  type="button"
                  className={`as2-mode ${i === 0 ? "feature" : ""}`}
                  onClick={() => chooseMode(m)}
                >
                  <span className="as2-m-ic"><Sparkles aria-hidden size={20} /></span>
                  <span className="as2-tagbar">{i === 0 ? "Fastest" : i === 1 ? "Guided" : "Full control"}</span>
                  <h3>{m === "ai" ? "AI generates it" : m === "assist" ? "AI helps you" : "Create your own"}</h3>
                  <p>{MODES[m].helper}</p>
                  <span className="as2-m-go">
                    Start <Send aria-hidden size={13} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toastMsg && <div className="as2-toast show">{toastMsg}</div>}
    </div>
  );
}

function FxSlider({
  label,
  min,
  max,
  value,
  suffix,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="as2-ctrl">
      <div className="as2-row">
        <span className="as2-sm as2-muted">{label}</span>
        <span className="as2-sm">{value}{suffix}</span>
      </div>
      <input type="range" className="as2-rng" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function AiEditRow({ disabled, onRun }: { disabled: boolean; onRun: (prompt: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <>
      <input
        className="as2-t"
        placeholder="AI change: e.g. brighter sky, warmer light"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        className="as2-btn accent block sm"
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!value.trim()) return;
          onRun(value.trim());
        }}
      >
        <Pencil aria-hidden size={13} />
        Apply AI change
      </button>
    </>
  );
}

function getMessage(error: unknown): string {
  return error instanceof Error ? error.message : "AdStudio request failed.";
}

const STYLES = `
.as2{position:relative;display:flex;flex-direction:column;min-height:720px;height:calc(100vh - 180px);border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--surface);color:var(--ink);font-size:14px}
.as2 *{box-sizing:border-box}
.as2 button{font-family:inherit;cursor:pointer}
.as2-topbar{height:54px;flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:var(--surface);border-bottom:1px solid var(--line)}
.as2-brandline{display:flex;align-items:center;gap:12px;min-width:0}
.as2-wordmark{font-weight:800;letter-spacing:-.03em;font-size:16px}
.as2-vline{width:1px;height:20px;background:var(--line)}
.as2-mode-pill{display:inline-flex;align-items:center;gap:7px;background:var(--surface-subtle);color:var(--accent-strong);border:1px solid var(--line);border-radius:99px;padding:4px 6px 4px 11px;font-size:12px;font-weight:700}
.as2-mode-pill button{border:0;background:var(--surface);border-radius:99px;font-size:10.5px;font-weight:700;color:var(--accent-strong);padding:3px 8px}
.as2-top-actions{display:flex;align-items:center;gap:9px}
.as2-provider{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--muted);background:var(--surface-subtle);border:1px solid var(--line);border-radius:99px;padding:6px 11px}
.as2-dot{width:7px;height:7px;border-radius:99px;background:var(--accent)}
.as2-btn{border:1px solid var(--line);background:var(--surface);border-radius:10px;height:36px;padding:0 14px;display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:700;color:var(--ink);white-space:nowrap;transition:.12s}
.as2-btn:hover{background:var(--surface-subtle)}
.as2-btn:disabled{opacity:.55;cursor:not-allowed}
.as2-btn.primary{background:var(--ink);color:#fff;border-color:var(--ink)}
.as2-btn.accent{background:var(--accent);color:#fff;border-color:var(--accent)}
.as2-btn.accent:hover{background:var(--accent-strong)}
.as2-btn.ghost{background:transparent;border-color:transparent;color:var(--accent-strong)}
.as2-btn.sm{height:30px;padding:0 11px;font-size:12px;border-radius:8px}
.as2-btn.block{width:100%;justify-content:center}
.as2-work{flex:1;min-height:0;display:grid;grid-template-columns:330px 1fr 320px}
.as2-pane{display:flex;flex-direction:column;min-height:0;min-width:0;background:var(--surface)}
.as2-pane.left{border-right:1px solid var(--line)}
.as2-pane.right{border-left:1px solid var(--line)}
.as2-pane-hd{padding:13px 16px;border-bottom:1px solid var(--line);flex:0 0 auto}
.as2-label{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:800}
.as2-pane-hd h2{margin:1px 0 0;font-size:16px;letter-spacing:-.02em}
.as2-pane-body{padding:15px 16px;display:flex;flex-direction:column;gap:13px;overflow-y:auto;min-height:0}
.as2 textarea,.as2 input.as2-t{width:100%;border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:9px 11px;font:inherit;font-size:13px;color:var(--ink);resize:vertical;outline:none;transition:.12s}
.as2 textarea:focus,.as2 input.as2-t:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--surface-subtle)}
.as2-prompt{min-height:84px}
.as2-helper{font-size:12.5px;color:var(--muted);line-height:1.45;margin:0}
.as2-mini-label{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:800;display:block;margin-bottom:8px}
.as2-quickstarts{display:flex;flex-direction:column;gap:7px}
.as2-qs{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--line);background:var(--surface);border-radius:11px;padding:10px 11px;text-align:left;transition:.12s;width:100%}
.as2-qs:hover{border-color:var(--accent)}
.as2-qs.sel{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.as2-qs-ic{width:26px;height:26px;border-radius:8px;background:var(--surface-subtle);color:var(--accent-strong);display:grid;place-items:center;flex:0 0 auto}
.as2-qs-t{font-size:13px;font-weight:700;letter-spacing:-.01em;display:block}
.as2-qs-d{font-size:11.5px;color:var(--muted);line-height:1.3;margin-top:1px;display:block}
.as2-dropzone{display:block;width:100%;border:1.5px dashed var(--line);border-radius:12px;background:var(--surface);padding:13px;text-align:center;color:var(--muted);transition:.12s;margin-top:8px}
.as2-dropzone:hover{border-color:var(--accent);color:var(--accent-strong)}
.as2-dropzone svg{display:block;margin:0 auto 6px}
.as2-dz-t{font-weight:700;font-size:12.5px;color:var(--ink)}
.as2-sm{font-size:12px}
.as2-muted{color:var(--muted)}
.as2-acc{border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden}
.as2-acc>summary{list-style:none;cursor:pointer;padding:11px 13px;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:space-between}
.as2-acc>summary::-webkit-details-marker{display:none}
.as2-chev{transition:transform .15s;color:var(--muted)}
.as2-acc[open]>summary .as2-chev{transform:rotate(90deg)}
.as2-acc-body{padding:0 13px 13px;display:flex;flex-direction:column;gap:10px}
.as2-kpis{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.as2-kpi{border:1px solid var(--line);border-radius:11px;background:var(--surface-subtle);padding:9px;text-align:center}
.as2-kpi .v{font-size:15px;font-weight:800;letter-spacing:-.02em}
.as2-kpi .k{font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:800;margin-top:1px}
.as2-gate{display:flex;gap:9px;align-items:flex-start;border:1px solid var(--line);border-radius:11px;padding:10px;background:var(--surface-subtle)}
.as2-gate-dot{width:20px;height:20px;border-radius:99px;display:grid;place-items:center;font-size:11px;font-weight:900;flex:0 0 auto}
.as2-gate.ok .as2-gate-dot{background:#e3f4ee;color:var(--accent-strong)}
.as2-gate.warn .as2-gate-dot{background:#fff2da;color:#8a5b10}
.as2-gate b{font-size:12.5px;text-transform:capitalize}
.as2-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.as2-swatches{display:flex;gap:8px}
.as2-sw{width:26px;height:26px;border-radius:8px;border:1px solid var(--line);cursor:pointer}
.as2-sw.sel{outline:2px solid var(--accent);outline-offset:1px}
.as2-rng{width:100%;accent-color:var(--accent)}
.as2-ctrl{display:flex;flex-direction:column;gap:4px}
.as2-counter{font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--muted)}
.as2-counter.over{color:#8a5b10}
.as2-copy-fields{display:flex;flex-direction:column;gap:9px}
.as2-efield{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:10px 11px;transition:box-shadow .15s,border-color .15s}
.as2-efield.flash{border-color:var(--accent);box-shadow:0 0 0 3px var(--surface-subtle)}
.as2-efield-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.as2-ef-right{display:flex;align-items:center;gap:7px}
.as2-ef{min-height:42px;background:var(--surface-subtle)}
.as2-rw{border:1px solid var(--line);background:var(--surface);border-radius:7px;width:24px;height:22px;display:grid;place-items:center;color:var(--accent-strong);padding:0}
.as2-rw:hover{background:var(--surface-subtle)}
.as2-variant{display:block;width:100%;text-align:left;border:1px solid var(--line);background:var(--surface);border-radius:11px;padding:10px 11px;transition:.12s}
.as2-variant:hover{border-color:var(--accent)}
.as2-variant .v-h{font-weight:700;font-size:13px;margin-bottom:2px}
.as2-variant .v-b{font-size:12px;color:var(--muted);line-height:1.4}
.as2-center{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--surface-subtle)}
.as2-canvas-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px;flex:0 0 auto;flex-wrap:wrap}
.as2-plat{display:flex;gap:4px}
.as2-plat button{border:1px solid var(--line);background:var(--surface);border-radius:9px;padding:6px 13px;font-size:12px;font-weight:700;color:var(--muted)}
.as2-plat button.active{background:var(--ink);color:#fff;border-color:var(--ink)}
.as2-seg{display:flex;gap:3px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:3px;flex-wrap:wrap}
.as2-seg button{border:0;background:transparent;border-radius:7px;padding:5px 9px;font-size:12px;font-weight:700;color:var(--muted);display:flex;flex-direction:column;align-items:center;line-height:1.12;gap:1px}
.as2-seg button .sub{font-size:8.5px;font-weight:600;color:var(--muted)}
.as2-seg button.active{background:var(--surface-subtle);color:var(--ink);box-shadow:inset 0 0 0 1px var(--line)}
.as2-placement-name{font-size:12px;font-weight:700;color:var(--muted)}
.as2-stage{flex:1;min-height:0;display:grid;place-items:center;padding:22px;overflow:auto;position:relative}
.as2-edit-hint{position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(24,32,31,.72);color:#fff;font-size:11px;font-weight:600;padding:4px 10px;border-radius:99px;opacity:0;transition:opacity .15s;pointer-events:none;z-index:6}
.as2-stage:hover .as2-edit-hint{opacity:1}
.as2-device{filter:drop-shadow(0 18px 50px rgba(24,32,31,.16))}
.as2-layer{cursor:pointer;position:relative;transition:box-shadow .12s;border-radius:6px}
.as2-layer:hover{box-shadow:0 0 0 2px rgba(8,127,122,.45)}
.as2-layer.sel{box-shadow:0 0 0 2px var(--accent)}
.as2-feed-card{width:var(--w,340px);background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6ebe8}
.as2-fc-top{display:flex;align-items:center;justify-content:space-between;padding:10px 12px}
.as2-fc-id{display:flex;align-items:center;gap:9px}
.as2-fc-av{width:34px;height:34px;border-radius:99px;color:#fff;display:grid;place-items:center;font-weight:800;font-size:13px}
.as2-fc-name{font-size:13px;font-weight:700;line-height:1.15}
.as2-fc-sub{font-size:11px;color:#8893a4;font-weight:600}
.as2-fc-dots{color:#aab3c1;font-weight:800}
.as2-fc-primary{padding:0 12px 10px;font-size:13px;line-height:1.4;color:var(--ink)}
.as2-fc-visual{width:100%;aspect-ratio:var(--ar,1/1);background:var(--surface-subtle);overflow:hidden;position:relative;display:grid;place-items:center}
.as2-fc-link{display:flex;align-items:center;gap:10px;justify-content:space-between;background:var(--surface-subtle);padding:11px 12px}
.as2-fc-domain{font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:#8893a4;font-weight:700}
.as2-fc-headline{font-size:15px;font-weight:800;letter-spacing:-.02em;line-height:1.15;color:var(--ink);margin-top:1px}
.as2-fc-desc{font-size:11.5px;color:var(--muted);line-height:1.3;margin-top:2px}
.as2-fc-cta{flex:0 0 auto;color:#fff;border-radius:7px;padding:9px 13px;font-size:12.5px;font-weight:700}
.as2-land-card{width:var(--w,470px);background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6ebe8}
.as2-vis-img{width:100%;height:100%;object-fit:cover;display:block}
.as2-vis-ph{text-align:center;color:var(--muted);font-size:12px;font-weight:600;padding:18px;max-width:230px}
.as2-vis-ph svg{display:block;margin:0 auto 8px}
.as2-story{width:var(--w,250px);aspect-ratio:9/16;border-radius:20px;overflow:hidden;position:relative;background:#1c2c40;color:#fff}
.as2-story-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.as2-story-fallback{background:linear-gradient(160deg,#2f4a47,#13211f)}
.as2-story-grad{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.38) 0%,rgba(0,0,0,0) 24%,rgba(0,0,0,0) 50%,rgba(0,0,0,.62) 100%)}
.as2-story-top{position:absolute;top:18px;left:12px;right:12px;display:flex;align-items:center;gap:8px;z-index:3}
.as2-story-av{width:28px;height:28px;border-radius:99px;border:1.5px solid #fff;display:grid;place-items:center;font-size:12px;font-weight:800;color:#fff;background:rgba(255,255,255,.18)}
.as2-story-name{font-size:12px;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,.5)}
.as2-story-sub{font-size:10px;opacity:.85;font-weight:600}
.as2-story-content{position:absolute;left:18px;right:18px;bottom:74px;z-index:5;display:flex;flex-direction:column;gap:6px}
.as2-story-headline{font-size:21px;font-weight:800;letter-spacing:-.025em;line-height:1.04;text-shadow:0 2px 10px rgba(0,0,0,.5);margin:0}
.as2-story-body{font-size:12px;line-height:1.35;opacity:.95;text-shadow:0 1px 6px rgba(0,0,0,.55);margin:0}
.as2-story-cta{position:absolute;left:50%;transform:translateX(-50%);bottom:22px;z-index:5;background:#fff;color:var(--ink);border-radius:99px;padding:10px 18px;font-size:12.5px;font-weight:800;box-shadow:0 6px 18px rgba(0,0,0,.3)}
.as2-gen-loading{position:absolute;inset:0;background:rgba(241,245,242,.85);display:grid;place-items:center;z-index:9}
.as2-gen-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 22px;box-shadow:0 14px 40px rgba(24,32,31,.12);display:flex;flex-direction:column;align-items:center;gap:10px;width:270px;text-align:center}
.as2-spinner{width:26px;height:26px;border-radius:99px;border:3px solid var(--surface-subtle);border-top-color:var(--accent);animation:as2spin .8s linear infinite}
@keyframes as2spin{to{transform:rotate(360deg)}}
.as2-gen-msg{font-weight:700;font-size:13px}
.as2-bar{width:100%;height:6px;border-radius:99px;background:var(--surface-subtle);overflow:hidden}
.as2-bar i{display:block;height:100%;width:40%;background:var(--accent);border-radius:99px;animation:as2fill 1.4s ease-in-out infinite}
@keyframes as2fill{0%{margin-left:-40%}100%{margin-left:100%}}
.as2-toast{position:absolute;bottom:18px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--ink);color:#fff;padding:10px 16px;border-radius:11px;font-size:13px;font-weight:600;box-shadow:0 14px 40px rgba(24,32,31,.2);opacity:0;transition:.2s;z-index:60;pointer-events:none}
.as2-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.as2-modescreen{position:absolute;inset:0;z-index:90;background:linear-gradient(180deg,var(--surface),var(--surface-subtle));display:grid;place-items:center;padding:24px}
.as2-ms-wrap{width:min(900px,96%);text-align:center}
.as2-ms-logo{width:46px;height:46px;border-radius:13px;color:#fff;display:grid;place-items:center;font-weight:800;font-size:22px;margin:0 auto 16px}
.as2-ms-wrap h1{font-size:28px;letter-spacing:-.035em;margin:0 0 8px}
.as2-ms-sub{color:var(--muted);font-size:14px;margin:0 auto 26px;max-width:520px}
.as2-modes{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.as2-mode{background:#fff;border:1px solid var(--line);border-radius:18px;padding:20px;text-align:left;transition:.14s;display:flex;flex-direction:column;gap:10px}
.as2-mode:hover{border-color:var(--accent);box-shadow:0 14px 40px rgba(24,32,31,.1);transform:translateY(-2px)}
.as2-m-ic{width:42px;height:42px;border-radius:12px;background:var(--surface-subtle);color:var(--accent-strong);display:grid;place-items:center}
.as2-mode.feature .as2-m-ic{background:var(--ink);color:#fff}
.as2-mode h3{margin:0;font-size:17px;letter-spacing:-.02em}
.as2-mode p{margin:0;font-size:13px;color:var(--muted);line-height:1.45}
.as2-m-go{margin-top:auto;font-size:12.5px;font-weight:700;color:var(--accent-strong);display:flex;align-items:center;gap:6px}
.as2-tagbar{font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--accent-strong)}
@media(max-width:1100px){.as2-work{grid-template-columns:1fr}.as2-pane.left,.as2-pane.right{border:0;border-bottom:1px solid var(--line)}}
@media(max-width:760px){.as2-modes{grid-template-columns:1fr}}
`;
