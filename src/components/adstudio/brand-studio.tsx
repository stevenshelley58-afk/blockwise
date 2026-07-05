"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

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

/* ------------------------------------------------------------------ */
/* colour helpers                                                      */
/* ------------------------------------------------------------------ */

type Hsv = { h: number; s: number; v: number };

function hexToHsv(hex: string): Hsv {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#888888";
  const r = parseInt(clean.slice(1, 3), 16) / 255;
  const g = parseInt(clean.slice(3, 5), 16) / 255;
  const b = parseInt(clean.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const f = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`.toUpperCase();
}

/* ------------------------------------------------------------------ */
/* swatch + in-app picker                                              */
/* ------------------------------------------------------------------ */

type SwatchProps = {
  label: string;
  value: string;
  sitePalette: string[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (hex: string) => void;
};

function ColorSwatch({ label, value, sitePalette, open, onOpen, onClose, onChange }: SwatchProps) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value.replace("#", ""));
  const svRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setHsv(hexToHsv(value));
      setHexText(value.replace("#", ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function commit(next: Hsv) {
    setHsv(next);
    const hex = hsvToHex(next);
    setHexText(hex.replace("#", ""));
    onChange(hex);
  }

  function pickFromField(event: React.PointerEvent<HTMLDivElement>) {
    const rect = svRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const v = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height));
    commit({ ...hsv, s, v });
  }

  return (
    <div className={`bs-swatch${open ? " open" : ""}`}>
      <button
        type="button"
        className="well"
        style={{ background: value }}
        aria-label={`Edit ${label} colour`}
        onClick={(event) => {
          event.stopPropagation();
          open ? onClose() : onOpen();
        }}
      />
      <b>{label}</b>
      <small>{value.toUpperCase()}</small>

      {open && (
        <div className="bs-picker" onClick={(event) => event.stopPropagation()}>
          <div
            ref={svRef}
            className="sv"
            style={{ ["--h" as string]: `hsl(${hsv.h},100%,50%)` }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              pickFromField(event);
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1) pickFromField(event);
            }}
          >
            <span className="cur" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
          </div>
          <input
            className="hue"
            type="range"
            min={0}
            max={360}
            value={hsv.h}
            onChange={(event) => commit({ ...hsv, h: Number(event.target.value) })}
          />
          {sitePalette.length > 0 && (
            <div className="from-site">
              <small>From your site</small>
              <div className="dots">
                {sitePalette.map((colour) => (
                  <button
                    key={colour}
                    type="button"
                    style={{ background: colour }}
                    aria-label={`Use ${colour}`}
                    onClick={() => commit(hexToHsv(colour))}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="pick-foot">
            <span className="hexwrap">
              #
              <input
                value={hexText}
                maxLength={6}
                onChange={(event) => {
                  setHexText(event.target.value);
                  if (/^[0-9a-f]{6}$/i.test(event.target.value)) {
                    const next = hexToHsv(`#${event.target.value}`);
                    setHsv(next);
                    onChange(`#${event.target.value.toUpperCase()}`);
                  }
                }}
              />
            </span>
            <button type="button" className="ok" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* tag row (phrases / never say)                                       */
/* ------------------------------------------------------------------ */

function TagRow({
  items,
  tone,
  onAdd,
  onRemove,
}: {
  items: string[];
  tone: "yes" | "no";
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  return (
    <div className="bs-tagrow">
      {items.map((item) => (
        <span key={item} className={tone === "no" ? "no" : ""}>
          {item}
          <b role="button" aria-label={`Remove ${item}`} onClick={() => onRemove(item)}>
            ✕
          </b>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={draft}
          placeholder="type, press Enter"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setAdding(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim()) {
              onAdd(draft.trim());
              setDraft("");
            }
            if (event.key === "Escape") setAdding(false);
          }}
        />
      ) : (
        <button type="button" className="addbtn" onClick={() => setAdding(true)}>
          ＋ Add phrase
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Brand Studio                                                        */
/* ------------------------------------------------------------------ */

const VOICE_PRESETS = ["Warm & personal", "Premium & understated", "Straight-talking", "Data-led"];
const VOICE_LIMIT = 300;

type ColourKey = "primary" | "secondary" | "accent" | "background" | "text";

const COLOUR_LABELS: Array<{ key: ColourKey; label: string }> = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "accent", label: "Accent" },
  { key: "background", label: "Background" },
  { key: "text", label: "Text" },
];

export function BrandStudio({ brandKit: initialKit }: { brandKit: AdStudioBrandKit | null }) {
  const [kit, setKit] = useState(initialKit);
  const [scanUrl, setScanUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  function flash(tone: "ok" | "err", text: string) {
    setNotice({ tone, text });
    window.setTimeout(() => setNotice(null), 3200);
  }

  async function scanSite() {
    if (busy) return;
    const websiteUrl = scanUrl.trim();
    if (!websiteUrl) {
      flash("err", "Enter your website address first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/adstudio/brand-kits/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl }),
      });
      const json = (await res.json().catch(() => ({}))) as { brandKit?: AdStudioBrandKit; error?: string };
      if (!res.ok || !json.brandKit) throw new Error(json.error || `Scan failed (${res.status})`);
      setKit(json.brandKit);
      flash("ok", "Scan complete - kit updated from your site.");
    } catch (error) {
      flash("err", error instanceof Error ? error.message : "Could not scan the site.");
    } finally {
      setBusy(false);
    }
  }

  if (kit) {
    return <BrandStudioEditor brandKit={kit} />;
  }

  return (
    <main className="bs-screen" aria-label="Brand Studio">
      <style>{BRAND_STYLES}</style>

      <div className="bs-top">
        <Link href="/ad-studio" className="back">
          {"< Ad Studio"}
        </Link>
        <h1>Brand Studio</h1>
        <div className="grow">{notice && <span className={`notice ${notice.tone}`}>{notice.text}</span>}</div>
      </div>

      <div className="bs-empty">
        <div className="bs-empty-panel">
          <span className="chip warn">Brand needed</span>
          <h2>Scan your website</h2>
          <p>Add your agency website to build a real brand kit before editing colours, logos, and ad previews.</p>
          <div className="scanline">
            <span className="url">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9s1.3-6.4 3.8-9z" />
              </svg>
              <input
                value={scanUrl}
                aria-label="Website"
                placeholder="youragency.com.au"
                onChange={(event) => setScanUrl(event.target.value)}
              />
            </span>
            <button type="button" className="go" disabled={busy} onClick={() => void scanSite()}>
              {busy ? "Scanning..." : "Scan site"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function BrandStudioEditor({ brandKit: initialKit }: { brandKit: AdStudioBrandKit }) {
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

        <div className="bs-logo-proof">
          <div className="lp">
            <div className="face" style={{ background: "#fff", color: kit.colours.primary }}>
              {logoPreviewUrl ? <img src={logoPreviewUrl} alt="" /> : `${initial}★ ${brandName.split(" ")[0]?.toLowerCase()}`}
            </div>
            <small>
              <b>Primary</b>
              <em>on light</em>
            </small>
          </div>
          <div className="lp">
            <div className="face" style={{ background: "#001b3d", color: "#fff" }}>
              {initial}★ {brandName.split(" ")[0]?.toLowerCase()}
            </div>
            <small>
              <b>Dark</b>
              <em>on dark</em>
            </small>
          </div>
          <div className="lp">
            <div className="face photo">{initial}★</div>
            <small>
              <b>Mark</b>
              <em>on photo</em>
            </small>
          </div>
        </div>

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

            <section className="bs-card">
              <h3>Voice &amp; tone</h3>
              <div className="f">
                <label>
                  How should your ads sound?
                  <small>
                    {(kit.tone.voice || "").length} / {VOICE_LIMIT}
                  </small>
                </label>
                <textarea
                  value={kit.tone.voice}
                  maxLength={VOICE_LIMIT}
                  rows={3}
                  onChange={(event) => setTone("voice", event.target.value)}
                />
                <div className="presets">
                  {VOICE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        setTone(
                          "voice",
                          `${(kit.tone.voice || "").replace(/\s*$/, "")}${kit.tone.voice ? " " : ""}${preset}.`.slice(
                            0,
                            VOICE_LIMIT,
                          ),
                        )
                      }
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
              </div>
              <div className="f">
                <label>Use phrases like</label>
                <TagRow
                  items={kit.tone.preferredPhrases}
                  tone="yes"
                  onAdd={(value) => setTone("preferredPhrases", [...kit.tone.preferredPhrases, value])}
                  onRemove={(value) =>
                    setTone(
                      "preferredPhrases",
                      kit.tone.preferredPhrases.filter((item) => item !== value),
                    )
                  }
                />
              </div>
              <div className="f">
                <label>Never say</label>
                <TagRow
                  items={kit.tone.avoid}
                  tone="no"
                  onAdd={(value) => setTone("avoid", [...kit.tone.avoid, value])}
                  onRemove={(value) =>
                    setTone(
                      "avoid",
                      kit.tone.avoid.filter((item) => item !== value),
                    )
                  }
                />
              </div>
            </section>

            <div className="bs-two">
              <section className="bs-card">
                <h3>Identity &amp; contact</h3>
                <div className="bs-kv">
                  <div className="r">
                    <span>Agency</span>
                    <input value={kit.identity.businessName} onChange={(e) => setIdentity("businessName", e.target.value)} />
                  </div>
                  <div className="r">
                    <span>Agent</span>
                    <input value={kit.identity.tradingName ?? ""} onChange={(e) => setIdentity("tradingName", e.target.value)} />
                  </div>
                  <div className="r">
                    <span>Phone</span>
                    <input value={kit.contact.phone ?? ""} onChange={(e) => setContact("phone", e.target.value)} />
                  </div>
                  <div className="r">
                    <span>Email</span>
                    <input value={kit.contact.email ?? ""} onChange={(e) => setContact("email", e.target.value)} />
                  </div>
                  <div className="r">
                    <span>Region</span>
                    <input value={kit.identity.marketRegion ?? ""} onChange={(e) => setIdentity("marketRegion", e.target.value)} />
                  </div>
                  <div className="r">
                    <span>Licence</span>
                    <input value={kit.identity.licenceText ?? ""} onChange={(e) => setIdentity("licenceText", e.target.value)} />
                  </div>
                </div>
              </section>
              <section className="bs-card">
                <h3>Compliance</h3>
                <div className="bs-disc">
                  {kit.compliance.disclaimers.map((disclaimer, index) => (
                    <textarea
                      key={index}
                      rows={2}
                      value={disclaimer}
                      onChange={(event) => setDisclaimer(index, event.target.value)}
                    />
                  ))}
                  <button
                    type="button"
                    className="add"
                    onClick={() =>
                      setKit((c) => ({
                        ...c,
                        compliance: { ...c.compliance, disclaimers: [...c.compliance.disclaimers, ""] },
                      }))
                    }
                  >
                    ＋ Add disclaimer
                  </button>
                </div>
              </section>
            </div>
          </div>

          <aside className="bs-rail">
            <div className="rail-stage">
              <span className="lbl">Live preview</span>
              <div className="minis">
                <div className="mini-story">
                  <span className="bc" style={{ color: kit.colours.primary }}>
                    {initial}★ {brandName.split(" ")[0]}
                  </span>
                  <h5>{headlineSample}</h5>
                  <span className="cta" style={{ color: kit.colours.primary }}>
                    Book free appraisal
                  </span>
                </div>
                <div className="mini-feed">
                  <div className="fh">
                    <i style={{ background: kit.colours.primary }}>{initial}</i>
                    <b>{brandName}</b>
                  </div>
                  <div className="img" />
                  <div className="ft">
                    <b>Free appraisal</b>
                    <span style={{ background: kit.colours.secondary }}>Book</span>
                  </div>
                </div>
              </div>
              <small>
                Re-renders as you edit — voice line:
                <br />
                <b>{voiceLine || "describe your voice above"}</b>
              </small>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* styles                                                              */
/* ------------------------------------------------------------------ */

const BRAND_STYLES = `
.bs-screen{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;background:#f8fafc;color:var(--ink);font-size:14px}
.bs-screen *{box-sizing:border-box}
.bs-screen button,.bs-screen input,.bs-screen textarea{font:inherit}
.bs-screen button{cursor:pointer;border:0;background:none;color:inherit}
.bs-screen .asset-upload-trigger{border:1.5px dashed var(--line);background:#fff;color:var(--ink)}
.bs-screen .asset-upload-clear{border:1px solid var(--line);background:#fff;color:var(--muted)}
.bs-screen .btn{height:38px;padding:0 16px;border-radius:9px;display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:13.5px}
.bs-screen .btn.pri{background:var(--accent);color:#fff;box-shadow:0 2px 8px rgba(18,62,117,.28)}
.bs-screen .btn.pri:hover{background:var(--accent-strong)}
.bs-screen .btn.sec{background:#fff;border:1px solid var(--line);box-shadow:0 1px 2px rgba(15,23,42,.05)}
.bs-screen .btn:disabled{opacity:.55;cursor:not-allowed}
.bs-screen .chip{font-size:11.5px;font-weight:650;border-radius:999px;padding:5px 11px}
.bs-screen .chip.good{background:#ecfdf5;color:#006d38}
.bs-screen .chip.warn{background:#fdf8ee;color:#8a5a00}
.bs-top{height:58px;background:#fff;border-bottom:1px solid var(--line-soft);display:flex;align-items:center;gap:14px;padding:0 20px;flex:0 0 auto}
.bs-top .back{color:var(--muted);font-weight:600;font-size:13px;text-decoration:none}
.bs-top h1{font-size:15.5px;font-weight:680;margin:0}
.bs-top .grow{margin-left:auto;display:flex;gap:9px;align-items:center}
.bs-top .notice{font-size:12.5px;font-weight:600}
.bs-top .notice.ok{color:#006d38}
.bs-top .notice.err{color:#ba1a1a}
.bs-scroll{flex:1;min-height:0;overflow:auto}
.bs-empty{flex:1;min-height:0;display:grid;place-items:center;padding:28px;background:#f8fafc}
.bs-empty-panel{width:min(620px,100%);display:grid;gap:16px;background:#fff;border:1px solid var(--line-soft);border-radius:14px;padding:28px;box-shadow:0 12px 34px rgba(15,23,42,.08)}
.bs-empty-panel h2{font-size:28px;line-height:1.1;margin:0;color:var(--ink)}
.bs-empty-panel p{margin:0;color:var(--muted);line-height:1.55}
.bs-empty .scanline{display:flex;gap:9px}
.bs-empty .url{flex:1;height:42px;border-radius:10px;background:#fff;border:1px solid var(--line);display:flex;align-items:center;gap:10px;padding:0 14px;color:var(--muted);font-size:13.5px}
.bs-empty .url svg{color:var(--muted);flex:0 0 auto}
.bs-empty .url input{flex:1;background:transparent;border:0;outline:0;color:var(--ink);min-width:0}
.bs-empty .go{height:42px;padding:0 18px;border-radius:10px;background:var(--accent);color:#fff;font-weight:650;white-space:nowrap}
.bs-empty .go:disabled{opacity:.6}
.bs-hero{background:linear-gradient(170deg,#001b3d 0%,#0d3263 90%);color:#fff;padding:30px 28px 78px}
.bs-hero .kick{font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#9aaac3}
.bs-hero h2{margin:8px 0 0}
.bs-hero h2 input{font-family:Georgia,serif;font-size:38px;letter-spacing:-.5px;line-height:1.05;background:transparent;border:0;outline:0;color:#fff;width:100%;border-bottom:1.5px dashed transparent}
.bs-hero h2 input:hover{border-bottom-color:rgba(255,255,255,.25)}
.bs-hero h2 input:focus{border-bottom-color:#31c46f}
.bs-hero .scanline{margin-top:18px;display:flex;gap:9px;max-width:560px}
.bs-hero .url{flex:1;height:42px;border-radius:10px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);display:flex;align-items:center;gap:10px;padding:0 14px;color:#d6e3ff;font-size:13.5px}
.bs-hero .url svg{color:#9aaac3;flex:0 0 auto}
.bs-hero .url input{flex:1;background:transparent;border:0;outline:0;color:#d6e3ff;min-width:0}
.bs-hero .go{height:42px;padding:0 18px;border-radius:10px;background:#fff;color:var(--ink);font-weight:650;white-space:nowrap}
.bs-hero .go:disabled{opacity:.6}
.bs-logo-proof{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:740px;margin:-50px 28px 0;position:relative;z-index:2}
.bs-logo-proof .lp{border-radius:14px;box-shadow:0 12px 34px rgba(15,23,42,.16);overflow:hidden;background:#fff}
.bs-logo-proof .face{height:90px;display:grid;place-items:center;font-weight:800;font-size:21px;letter-spacing:-.3px}
.bs-logo-proof .face img{display:block;max-width:78%;max-height:58px;object-fit:contain}
.bs-logo-proof .face.photo{background:linear-gradient(160deg,#3a608f,#0d3263);color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.4)}
.bs-logo-proof small{display:flex;justify-content:space-between;padding:8px 12px;font-size:11px;color:var(--muted);background:#fff}
.bs-logo-proof small b{font-weight:650;color:var(--ink)}
.bs-logo-proof small em{font-style:normal;color:var(--faint,#94a3b8)}
.bs-body{display:grid;grid-template-columns:1fr 320px;gap:22px;padding:24px 28px 40px}
.bs-main{display:grid;gap:18px;align-content:start;min-width:0}
.bs-card{background:#fff;border-radius:14px;box-shadow:0 1px 2px rgba(15,23,42,.05),0 0 0 1px rgba(15,23,42,.03);padding:20px;display:grid;gap:14px}
.bs-card h3{font-size:15.5px;font-weight:680;letter-spacing:-.2px;margin:0}
.bs-card .subtle{font-size:12.5px;color:var(--muted)}
.bs-swrow{display:flex;gap:14px;flex-wrap:wrap}
.bs-swatch{display:grid;gap:7px;justify-items:center;position:relative}
.bs-swatch .well{width:64px;height:64px;border-radius:16px;border:1px solid rgba(15,23,42,.08);box-shadow:0 1px 2px rgba(15,23,42,.05);transition:transform .12s;padding:0}
.bs-swatch .well:hover{transform:translateY(-2px)}
.bs-swatch.open .well{outline:2.5px solid var(--accent);outline-offset:2px}
.bs-swatch b{font-size:12px;font-weight:650}
.bs-swatch small{font-size:10.5px;color:var(--faint,#94a3b8);letter-spacing:.4px}
.bs-picker{position:absolute;top:76px;left:50%;transform:translateX(-50%);z-index:40;width:248px;background:#fff;border-radius:14px;box-shadow:0 10px 32px rgba(15,23,42,.16),0 2px 6px rgba(15,23,42,.07);padding:14px;display:grid;gap:11px}
.bs-picker::before{content:"";position:absolute;top:-6px;left:50%;transform:translateX(-50%) rotate(45deg);width:12px;height:12px;background:#fff;border-radius:2px}
.bs-picker .sv{position:relative;width:100%;aspect-ratio:5/3.4;border-radius:10px;cursor:crosshair;touch-action:none;background:linear-gradient(0deg,#000,transparent),linear-gradient(90deg,#fff,transparent),var(--h,#888)}
.bs-picker .sv .cur{position:absolute;width:14px;height:14px;border-radius:99px;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);transform:translate(-7px,-7px);pointer-events:none}
.bs-picker .hue{appearance:none;-webkit-appearance:none;width:100%;height:12px;border-radius:99px;outline:0;cursor:pointer;background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)}
.bs-picker .hue::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:99px;background:#fff;border:1.5px solid rgba(0,0,0,.15);box-shadow:0 1px 4px rgba(0,0,0,.3)}
.bs-picker .from-site{display:grid;gap:6px}
.bs-picker .from-site small{font-size:10.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--faint,#94a3b8)}
.bs-picker .from-site .dots{display:flex;gap:7px}
.bs-picker .from-site .dots button{width:22px;height:22px;border-radius:7px;border:1px solid rgba(15,23,42,.1);padding:0}
.bs-picker .pick-foot{display:flex;align-items:center;gap:8px}
.bs-picker .hexwrap{flex:1;height:34px;border:1px solid var(--line);border-radius:8px;display:flex;align-items:center;padding:0 10px;gap:6px;font-weight:600;font-size:12.5px}
.bs-picker .hexwrap input{border:0;outline:0;width:100%;text-transform:uppercase;letter-spacing:.5px;background:transparent}
.bs-picker .ok{height:34px;padding:0 13px;border-radius:8px;background:var(--accent);color:#fff;font-weight:650;font-size:12.5px}
.bs-spec{display:grid;grid-template-columns:106px 1fr;gap:18px;align-items:center}
.bs-spec .aa{font-family:Georgia,serif;font-size:54px;font-weight:750;letter-spacing:-2px;background:var(--accent-tint);color:var(--accent-strong);border-radius:12px;display:grid;place-items:center;height:100px}
.bs-spec .rows{display:grid;gap:12px;min-width:0}
.bs-spec small{display:block;color:var(--faint,#94a3b8);font-size:11px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;margin-bottom:3px}
.bs-spec .font-name{border:0;background:var(--line-soft);border-radius:7px;padding:3px 8px;font-weight:650;font-size:11px;width:120px;outline:0;text-transform:none;letter-spacing:0}
.bs-spec .h-sample{font-family:Georgia,serif;font-size:19px;font-weight:750;letter-spacing:-.2px;display:block}
.bs-spec .b-sample{font-size:13px;color:var(--muted);display:block}
.bs-card .f{display:grid;gap:7px}
.bs-card .f>label{font-size:12.5px;font-weight:650;display:flex;justify-content:space-between;align-items:center}
.bs-card .f>label small{color:var(--faint,#94a3b8);font-weight:550;font-size:11.5px}
.bs-card .f textarea{width:100%;border:1px solid var(--line);border-radius:10px;background:#fff;padding:12px 13px;font-size:13.5px;line-height:1.55;resize:vertical;outline:0;min-height:74px;color:var(--ink)}
.bs-card .f textarea:focus{border-color:var(--accent);box-shadow:0 0 0 2.5px var(--accent-tint)}
.bs-card .presets{display:flex;flex-wrap:wrap;gap:6px}
.bs-card .presets button{font-size:12px;font-weight:600;color:var(--muted);background:var(--line-soft);border-radius:999px;padding:6px 12px}
.bs-card .presets button:hover{background:var(--accent-tint);color:var(--accent)}
.bs-tagrow{display:flex;flex-wrap:wrap;gap:6px}
.bs-tagrow span{display:inline-flex;align-items:center;gap:7px;background:var(--accent-tint);color:var(--accent);border-radius:999px;padding:7px 12px;font-size:12.5px;font-weight:600}
.bs-tagrow span.no{background:#fdf3f2;color:#ba1a1a}
.bs-tagrow span b{cursor:pointer;opacity:.55;font-weight:700}
.bs-tagrow span b:hover{opacity:1}
.bs-tagrow .addbtn{display:inline-flex;align-items:center;gap:6px;border:1.5px dashed var(--line);color:var(--muted);border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:600;background:transparent}
.bs-tagrow .addbtn:hover{color:var(--accent);border-color:var(--accent)}
.bs-tagrow input{border:1.5px solid var(--accent);border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:600;outline:0;width:160px;background:#fff;color:var(--ink)}
.bs-two{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.bs-kv{display:grid;gap:4px;font-size:13px}
.bs-kv .r{display:grid;grid-template-columns:84px 1fr;align-items:center;gap:12px;border-bottom:1px solid var(--line-soft);min-height:38px}
.bs-kv .r:last-child{border:0}
.bs-kv .r span{color:var(--muted)}
.bs-kv .r input{border:0;outline:0;background:transparent;font-weight:600;width:100%;border-bottom:1.5px dashed transparent;padding:2px 0;color:var(--ink)}
.bs-kv .r input:hover{border-bottom-color:var(--line)}
.bs-kv .r input:focus{border-bottom-color:var(--accent)}
.bs-disc{display:grid;gap:7px}
.bs-disc textarea{font-size:12.5px;line-height:1.5;color:var(--muted);background:#f8fafc;border-radius:9px;padding:10px 12px;border:0;outline:0;resize:none;width:100%}
.bs-disc textarea:focus{outline:2px solid var(--accent-tint)}
.bs-disc .add{border:1.5px dashed var(--line);color:var(--faint,#94a3b8);border-radius:9px;padding:9px;font-size:12px;font-weight:600;background:transparent}
.bs-rail{display:grid;gap:14px;align-content:start;position:sticky;top:20px;height:max-content}
.bs-rail .rail-stage{background:#001b3d;border-radius:14px;padding:18px 16px;display:grid;gap:12px;justify-items:center}
.bs-rail .lbl{color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase}
.bs-rail .minis{display:flex;gap:12px}
.bs-rail .mini-story{width:126px;aspect-ratio:9/16;border-radius:14px;position:relative;overflow:hidden;background:linear-gradient(168deg,#3a608f,#0d3263);color:#fff;box-shadow:0 14px 34px rgba(0,0,0,.45)}
.bs-rail .mini-story::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 35%,rgba(8,12,20,.85) 82%)}
.bs-rail .mini-story .bc{position:absolute;top:7px;left:7px;background:rgba(255,255,255,.94);border-radius:99px;padding:3px 7px;font-size:6.5px;font-weight:750}
.bs-rail .mini-story h5{position:absolute;left:8px;right:8px;bottom:24px;font-family:Georgia,serif;font-size:10px;line-height:1.25;font-weight:750;z-index:1;margin:0}
.bs-rail .mini-story .cta{position:absolute;left:8px;right:8px;bottom:6px;height:15px;border-radius:4px;background:#fff;font-size:6.5px;font-weight:750;display:grid;place-items:center;z-index:1}
.bs-rail .mini-feed{width:126px;border-radius:12px;background:#fff;overflow:hidden;box-shadow:0 14px 34px rgba(0,0,0,.45)}
.bs-rail .mini-feed .fh{display:flex;align-items:center;gap:4px;padding:6px 7px}
.bs-rail .mini-feed .fh i{width:11px;height:11px;border-radius:99px;color:#fff;display:grid;place-items:center;font-style:normal;font-size:6px;font-weight:800}
.bs-rail .mini-feed .fh b{font-size:7px;color:var(--ink)}
.bs-rail .mini-feed .img{height:72px;background:linear-gradient(160deg,#3a608f,#0d3263)}
.bs-rail .mini-feed .ft{display:flex;justify-content:space-between;align-items:center;background:#f1f5f9;padding:5px 7px}
.bs-rail .mini-feed .ft b{font-size:6.5px;color:var(--ink)}
.bs-rail .mini-feed .ft span{color:#fff;border-radius:3px;padding:2px 5px;font-size:6px;font-weight:700}
.bs-rail .rail-stage small{color:#94a3b8;font-size:11px;text-align:center;line-height:1.5}
.bs-rail .rail-stage small b{color:#d6e3ff}
@media(max-width:1000px){
  .bs-body{grid-template-columns:1fr}
  .bs-rail{position:static}
  .bs-logo-proof{grid-template-columns:1fr;margin:-50px 16px 0}
  .bs-hero h2 input{font-size:28px}
  .bs-empty .scanline{display:grid}
  .bs-two{grid-template-columns:1fr}
}
`;
