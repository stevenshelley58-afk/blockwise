"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
    <div className={`relative grid justify-items-center gap-2 ${open ? "z-40" : ""}`}>
      <button
        type="button"
        className="min-h-16 min-w-16 rounded-(--r-card) border border-(--ui-border) shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2"
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
        <div className="absolute left-1/2 top-20 z-40 grid w-[min(248px,calc(100vw-2rem))] -translate-x-1/2 gap-3 rounded-(--r-card) border border-(--ui-border) bg-(--ui-background) p-4 shadow-lg" onClick={(event) => event.stopPropagation()}>
          <div
            ref={svRef}
            className="relative aspect-[5/3.4] w-full cursor-crosshair touch-none rounded-(--r-control) bg-[linear-gradient(0deg,#000,transparent),linear-gradient(90deg,#fff,transparent),var(--h,#888)]"
            style={{ ["--h" as string]: `hsl(${hsv.h},100%,50%)` }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              pickFromField(event);
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1) pickFromField(event);
            }}
          >
            <span className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
          </div>
          <input
            className="min-h-11 w-full accent-(--ui-primary)"
            type="range"
            min={0}
            max={360}
            value={hsv.h}
            onChange={(event) => commit({ ...hsv, h: Number(event.target.value) })}
          />
          {sitePalette.length > 0 && (
            <div className="grid gap-2">
              <small className="text-xs font-semibold text-(--ui-muted-foreground)">From your site</small>
              <div className="flex flex-wrap gap-2">
                {sitePalette.map((colour) => (
                  <button
                    key={colour}
                    type="button"
                    className="min-h-11 min-w-11 rounded-md border border-(--ui-border) focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ background: colour }}
                    aria-label={`Use ${colour}`}
                    onClick={() => commit(hexToHsv(colour))}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="flex min-h-11 flex-1 items-center gap-1 rounded-(--r-control) border border-(--ui-border) px-3 text-sm">
              #
              <input
                aria-label={`${label} hex value`}
                className="min-w-0 flex-1 bg-transparent outline-none"
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
            <button type="button" className="min-h-11 rounded-full bg-(--ui-primary) px-4 text-sm font-semibold text-(--ui-primary-foreground) focus-visible:outline-2 focus-visible:outline-offset-2" onClick={onClose}>
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
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <span key={item} className={`inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold ${tone === "no" ? "bg-(--ui-destructive)/10 text-(--ui-destructive)" : "bg-(--ui-muted) text-(--ui-foreground)"}`}>
          {item}
          <button type="button" aria-label={`Remove ${item}`} onClick={() => onRemove(item)}>Remove</button>
        </span>
      ))}
      {adding ? (
        <input aria-label="New phrase" className="min-h-11 min-w-0 rounded-full border border-(--ui-border) px-3 text-sm outline-none focus-visible:ring-2"
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
        <button type="button" className="min-h-11 rounded-full border border-dashed border-(--ui-border) px-4 text-sm font-semibold text-(--ui-muted-foreground) focus-visible:outline-2" onClick={() => setAdding(true)}>
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

type BrandKitResponse = {
  brandKit?: AdStudioBrandKit;
  error?: string;
  persistence?: {
    status?: "persisted" | "not_persisted";
    warning?: string;
  };
};

function requirePersistedBrandKit(payload: BrandKitResponse, response: Response, action: string): AdStudioBrandKit {
  if (!response.ok || !payload.brandKit) {
    throw new Error(payload.error || `${action} failed (${response.status})`);
  }
  if (payload.persistence?.status === "not_persisted") {
    throw new Error(payload.persistence.warning || `${action} could not be saved. Try again.`);
  }
  return payload.brandKit;
}

function normalizedWebsiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function BrandStudio({ brandKit: initialKit, returnTo = "/ad-studio" }: { brandKit: AdStudioBrandKit | null; returnTo?: string }) {
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
      const json = (await res.json().catch(() => ({}))) as BrandKitResponse;
      setKit(requirePersistedBrandKit(json, res, "Scan"));
      flash("ok", "Scan complete - kit updated from your site.");
    } catch (error) {
      flash("err", error instanceof Error ? error.message : "Could not scan the site.");
    } finally {
      setBusy(false);
    }
  }

  if (kit) {
    return <BrandStudioEditor brandKit={kit} returnTo={returnTo} />;
  }

  return (
    <main className="tw flex min-h-screen flex-col bg-(--ui-background) font-sans text-(--ui-foreground)" aria-label="Brand Studio">

      <div className="flex min-h-16 flex-wrap items-center gap-3 border-b border-(--ui-border) bg-(--ui-background) px-4 py-3 md:px-6">
        <Link href={returnTo} className="min-h-11 inline-flex items-center text-sm font-semibold text-(--ui-muted-foreground) underline-offset-4 hover:underline focus-visible:outline-2">
          {"< Close"}
        </Link>
        <h1>Brand Studio</h1>
        <div className="ml-auto flex min-h-11 items-center gap-3 text-sm font-semibold" aria-live="polite">{notice && <span className={notice.tone === "err" ? "text-(--ui-destructive)" : "text-(--ui-success)"}>{notice.text}</span>}</div>
      </div>

      <div className="grid flex-1 place-items-center bg-(--ui-muted)/30 p-4 md:p-8">
        <div className="grid w-full max-w-2xl gap-4 rounded-(--r-panel) border border-(--ui-border) bg-(--ui-background) p-5 shadow-sm md:p-8">
          <span className="w-fit rounded-full bg-(--ui-muted) px-3 py-1 text-xs font-semibold text-(--ui-muted-foreground)">Optional setup</span>
          <h2>Enter your website. We’ll build your brand kit.</h2>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void scanSite();
            }}
          >
            <label htmlFor="brand-website">Your website address</label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <span className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-(--r-control) border border-(--ui-border) bg-(--ui-background) px-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9s1.3-6.4 3.8-9z" />
              </svg>
              <input aria-label="Website address" className="min-w-0 flex-1 bg-transparent outline-none"
                id="brand-website"
                value={scanUrl}
                inputMode="url"
                autoComplete="url"
                placeholder="e.g. youragency.com.au"
                onChange={(event) => setScanUrl(event.target.value)}
              />
              </span>
              <button type="submit" className="min-h-12 rounded-full bg-(--ui-primary) px-5 font-semibold text-(--ui-primary-foreground) disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2" disabled={busy}>
                {busy ? "Building your kit…" : "Build my brand kit"}
              </button>
            </div>
            <small>You can skip this and keep generating ads. Add it when you want consistent brand details.</small>
          </form>
        </div>
      </div>
    </main>
  );
}

function BrandStudioEditor({ brandKit: initialKit, returnTo }: { brandKit: AdStudioBrandKit; returnTo: string }) {
  const router = useRouter();
  const [kit, setKit] = useState(initialKit);
  const [openSwatch, setOpenSwatch] = useState<ColourKey | null>(null);
  const [scanUrl, setScanUrl] = useState(() => initialKit.source.url.replace(/^https?:\/\//, ""));
  const [busy, setBusy] = useState<"" | "scan" | "approve">("");
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
      const json = (await res.json().catch(() => ({}))) as BrandKitResponse;
      const scannedKit = requirePersistedBrandKit(json, res, "Scan");
      setKit(scannedKit);
      setLogoFile(null);
      setLogoPreviewUrl(scannedKit.logos.primaryLogoUrl ?? "");
      setScanUrl(scannedKit.source.url.replace(/^https?:\/\//, ""));
      flash("ok", "Scan complete — kit updated from your site.");
    } catch (error) {
      flash("err", error instanceof Error ? error.message : "Could not scan the site.");
    } finally {
      setBusy("");
    }
  }

  async function approveKit() {
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
    setBusy("approve");
    try {
      const uploadedLogoUrl = logoToUpload ? await uploadLogoAsset(logoToUpload) : null;
      const nextLogos = uploadedLogoUrl
        ? { ...kit.logos, primaryLogoUrl: uploadedLogoUrl }
        : kit.logos;
      const sourceUrl = normalizedWebsiteUrl(scanUrl);
      const submittedKit: AdStudioBrandKit = {
        ...kit,
        source: { ...kit.source, url: sourceUrl },
        logos: nextLogos,
      };
      const res = await fetch(`/api/adstudio/brand-kits/${kit.brandKitId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandKit: submittedKit }),
      });
      const json = (await res.json().catch(() => ({}))) as BrandKitResponse;
      const savedKit = requirePersistedBrandKit(json, res, "Approval");
      setKit(savedKit);
      setScanUrl(savedKit.source.url.replace(/^https?:\/\//, ""));
      setLogoPreviewUrl(savedKit.logos.primaryLogoUrl ?? "");
      setLogoFile(null);
      router.replace(returnTo);
      router.refresh();
    } catch (error) {
      flash("err", error instanceof Error ? error.message : "Could not save the kit.");
    } finally {
      setBusy("");
    }
  }

  const brandName = kit.identity.businessName || "Your brand";
  const voiceLine = (kit.tone.voice || "").split(".")[0];
  const approved = kit.reviewStatus === "approved";
  const logoDisplayName = logoFile?.name ?? (logoPreviewUrl ? "Primary logo" : undefined);

  return (
    <main className="tw min-h-screen bg-(--ui-background) font-sans text-(--ui-foreground)" aria-label="Brand Studio">

      <div className="flex min-h-16 flex-wrap items-center gap-3 border-b border-(--ui-border) bg-(--ui-background) px-4 py-3 md:px-6">
        <Link href={returnTo} className="min-h-11 inline-flex items-center text-sm font-semibold text-(--ui-muted-foreground) underline-offset-4 hover:underline focus-visible:outline-2">
          ‹ Close
        </Link>
        <h1>Brand Studio</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${approved ? "bg-(--ui-success-soft) text-(--ui-success)" : "bg-(--ui-warning-soft) text-(--ui-warning)"}`}>{approved ? "✓ Approved" : "Pending review"}</span>
        <div className="ml-auto flex min-h-11 flex-wrap items-center justify-end gap-3 text-sm font-semibold" aria-live="polite">
          {notice && <span className={notice.tone === "err" ? "text-(--ui-destructive)" : "text-(--ui-success)"}>{notice.text}</span>}
          <button className="min-h-11 rounded-full bg-(--ui-primary) px-5 font-semibold text-(--ui-primary-foreground) disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2" type="button" disabled={busy !== ""} onClick={() => void approveKit()}>
            {busy === "approve" ? "Approving…" : "✓ Approve kit"}
          </button>
        </div>
      </div>

      <div className="min-h-0 overflow-auto">
        <div className="border-b border-(--ui-border) bg-(--ui-muted)/30 px-4 pb-8 pt-6 md:px-8 md:pt-8">
          <div className="font-mono text-xs uppercase tracking-[0.12em] text-(--ui-muted-foreground)">Brand kit · Real estate · {kit.identity.marketRegion ?? "AU"}</div>
          <h2>
            <input
              value={kit.identity.businessName}
              aria-label="Agency name"
              onChange={(event) => setIdentity("businessName", event.target.value)}
            />
          </h2>
          <form
            className="mt-5 grid max-w-2xl gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void scanSite();
            }}
          >
            <strong>Enter your website and we’ll do the setup</strong>
            <span className="text-sm text-(--ui-muted-foreground)">We’ll pull in your logo, colours, fonts, and business details automatically.</span>
            <label htmlFor="brand-website">Your website address</label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <span className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-(--r-control) border border-(--ui-border) bg-(--ui-background) px-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9s1.3-6.4 3.8-9z" />
              </svg>
                <input
                  id="brand-website"
                  value={scanUrl}
                  inputMode="url"
                  autoComplete="url"
                  placeholder="e.g. youragency.com.au"
                  onChange={(event) => setScanUrl(event.target.value)}
                />
              </span>
              <button type="submit" className="min-h-11 rounded-full bg-(--ui-primary) px-5 font-semibold text-(--ui-primary-foreground) disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2" disabled={busy !== ""}>
                {busy === "scan" ? "Updating your kit…" : "Update from website"}
              </button>
            </div>
            <small>Review and change anything below before you approve it.</small>
          </form>
        </div>

        <div className="mx-4 grid gap-3 md:mx-8 md:grid-cols-3">
          <div className="overflow-hidden rounded-(--r-card) border border-(--ui-border) bg-(--ui-background) shadow-sm">
            <div className="grid min-h-24 place-items-center p-4" style={{ background: "#fff", color: kit.colours.primary }}>
              {logoPreviewUrl ? <img src={logoPreviewUrl} alt={`${brandName} primary logo`} /> : <span className="text-xs text-(--ui-muted-foreground)">Not found</span>}
            </div>
            <small className="flex justify-between gap-2 px-3 py-2 text-xs text-(--ui-muted-foreground)">
              <b>Primary</b>
              <em>on light</em>
            </small>
          </div>
          <div className="overflow-hidden rounded-(--r-card) border border-(--ui-border) bg-(--ui-background) shadow-sm">
            <div className="grid min-h-24 place-items-center p-4" style={{ background: "#16181d", color: "#fff" }}>
              {kit.logos.lightLogoUrl ? (
                <img src={kit.logos.lightLogoUrl} alt={`${brandName} light logo`} />
              ) : (
                <span className="text-xs text-(--ui-muted-foreground)">Not found</span>
              )}
            </div>
            <small className="flex justify-between gap-2 px-3 py-2 text-xs text-(--ui-muted-foreground)">
              <b>Dark</b>
              <em>on dark</em>
            </small>
          </div>
          <div className="overflow-hidden rounded-(--r-card) border border-(--ui-border) bg-(--ui-background) shadow-sm">
            <div className="grid min-h-24 place-items-center bg-(--ui-muted) p-4 text-(--ui-background)">
              {kit.logos.faviconUrl ? (
                <img src={kit.logos.faviconUrl} alt={`${brandName} brand mark`} />
              ) : (
                <span className="text-xs text-(--ui-muted-foreground)">Not found</span>
              )}
            </div>
            <small className="flex justify-between gap-2 px-3 py-2 text-xs text-(--ui-muted-foreground)">
              <b>Mark</b>
              <em>on photo</em>
            </small>
          </div>
        </div>

        <div className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 md:grid-cols-[minmax(0,1fr)_320px] md:px-8">
          <div className="grid min-w-0 content-start gap-5">
            <section className="grid gap-4 rounded-(--r-panel) border border-(--ui-border) bg-(--ui-background) p-5 shadow-sm">
              <h3>Logo</h3>
              <AssetUploadDropzone
                className="min-h-28"
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

            <section className="grid gap-4 rounded-(--r-panel) border border-(--ui-border) bg-(--ui-background) p-5 shadow-sm">
              <h3>Colours</h3>
              <div className="flex flex-wrap gap-4">
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
              <span className="text-sm text-(--ui-muted-foreground)">Click a swatch to change it — the preview updates as you pick.</span>
            </section>

            <section className="grid gap-4 rounded-(--r-panel) border border-(--ui-border) bg-(--ui-background) p-5 shadow-sm">
              <h3>Typography</h3>
              <div className="grid items-center gap-5 sm:grid-cols-[106px_1fr]">
                <div className="grid min-h-24 place-items-center rounded-(--r-card) bg-(--ui-muted) text-5xl font-extrabold">Aa</div>
                <div className="grid min-w-0 gap-4">
                  <div>
                    <small>
                      Headings ·{" "}
                      <input
                        className="min-h-11 max-w-full rounded-(--r-control) border border-(--ui-border) px-3 text-sm outline-none focus-visible:ring-2"
                        value={kit.typography.headingFont}
                        aria-label="Heading font"
                       onChange={(event) =>
                          setKit((c) => ({ ...c, typography: { ...c.typography, headingFont: event.target.value } }))
                        }
                      />
                    </small>
                    <span className="font-display text-lg font-extrabold">{headlineSample}</span>
                  </div>
                  <div>
                    <small>
                      Body ·{" "}
                      <input
                        className="min-h-11 max-w-full rounded-(--r-control) border border-(--ui-border) px-3 text-sm outline-none focus-visible:ring-2"
                        value={kit.typography.bodyFont}
                        aria-label="Body font"
                        onChange={(event) =>
                          setKit((c) => ({ ...c, typography: { ...c.typography, bodyFont: event.target.value } }))
                        }
                      />
                    </small>
                    <span className="text-sm text-(--ui-muted-foreground)">
                      Local sales are setting new benchmarks. Get a free, no-pressure appraisal.
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-4 rounded-(--r-panel) border border-(--ui-border) bg-(--ui-background) p-5 shadow-sm">
              <h3>Voice &amp; tone</h3>
              <div className="grid gap-2">
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
                <div className="flex flex-wrap gap-2">
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
              <div className="grid gap-2">
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
              <div className="grid gap-2">
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

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="grid gap-4 rounded-(--r-panel) border border-(--ui-border) bg-(--ui-background) p-5 shadow-sm">
                <h3>Identity &amp; contact</h3>
                <div className="grid gap-2">
                  <div className="grid gap-1 border-b border-(--ui-border) pb-2 sm:grid-cols-[84px_1fr] sm:items-center">
                    <label htmlFor="brand-agency" className="text-sm text-(--ui-muted-foreground)">Agency</label>
                    <input id="brand-agency" className="min-h-11 min-w-0 rounded-(--r-control) border border-(--ui-border) px-3 text-sm outline-none focus-visible:ring-2" value={kit.identity.businessName} onChange={(e) => setIdentity("businessName", e.target.value)} />
                  </div>
                  <div className="grid gap-1 border-b border-(--ui-border) pb-2 sm:grid-cols-[84px_1fr] sm:items-center">
                    <label htmlFor="brand-agent" className="text-sm text-(--ui-muted-foreground)">Agent</label>
                    <input id="brand-agent" className="min-h-11 min-w-0 rounded-(--r-control) border border-(--ui-border) px-3 text-sm outline-none focus-visible:ring-2" value={kit.identity.tradingName ?? ""} onChange={(e) => setIdentity("tradingName", e.target.value)} />
                  </div>
                  <div className="grid gap-1 border-b border-(--ui-border) pb-2 sm:grid-cols-[84px_1fr] sm:items-center">
                    <label htmlFor="brand-phone" className="text-sm text-(--ui-muted-foreground)">Phone</label>
                    <input id="brand-phone" type="tel" className="min-h-11 min-w-0 rounded-(--r-control) border border-(--ui-border) px-3 text-sm outline-none focus-visible:ring-2" value={kit.contact.phone ?? ""} onChange={(e) => setContact("phone", e.target.value)} />
                  </div>
                  <div className="grid gap-1 border-b border-(--ui-border) pb-2 sm:grid-cols-[84px_1fr] sm:items-center">
                    <label htmlFor="brand-email" className="text-sm text-(--ui-muted-foreground)">Email</label>
                    <input id="brand-email" type="email" className="min-h-11 min-w-0 rounded-(--r-control) border border-(--ui-border) px-3 text-sm outline-none focus-visible:ring-2" value={kit.contact.email ?? ""} onChange={(e) => setContact("email", e.target.value)} />
                  </div>
                  <div className="grid gap-1 border-b border-(--ui-border) pb-2 sm:grid-cols-[84px_1fr] sm:items-center">
                    <span>Region</span>
                    <input aria-label="Region" className="min-h-11 min-w-0 rounded-(--r-control) border border-(--ui-border) px-3 text-sm outline-none focus-visible:ring-2" value={kit.identity.marketRegion ?? ""} onChange={(e) => setIdentity("marketRegion", e.target.value)} />
                  </div>
                  <div className="grid gap-1 border-b border-(--ui-border) pb-2 sm:grid-cols-[84px_1fr] sm:items-center">
                    <span>Licence</span>
                    <input aria-label="Licence" className="min-h-11 min-w-0 rounded-(--r-control) border border-(--ui-border) px-3 text-sm outline-none focus-visible:ring-2" value={kit.identity.licenceText ?? ""} onChange={(e) => setIdentity("licenceText", e.target.value)} />
                  </div>
                </div>
              </section>
              <section className="grid gap-4 rounded-(--r-panel) border border-(--ui-border) bg-(--ui-background) p-5 shadow-sm">
                <h3>Compliance</h3>
                <div className="grid gap-2">
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
                    className="min-h-11 rounded-(--r-control) border border-dashed border-(--ui-border) px-3 text-sm font-semibold text-(--ui-muted-foreground) focus-visible:outline-2"
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

          <aside className="h-max md:sticky md:top-5">
            <div className="grid justify-items-center gap-4 rounded-(--r-panel) border border-(--ui-border) bg-(--ui-foreground) p-5 text-(--ui-background)">
              <span className="font-mono text-xs uppercase tracking-[0.12em] text-(--ui-muted-foreground)">Live preview</span>
              <div className="flex flex-wrap justify-center gap-3">
                <div className="relative aspect-[9/16] w-32 overflow-hidden rounded-(--r-card) bg-(--ui-muted) p-2 text-(--ui-background)">
                  <span className="rounded-full bg-(--ui-background) px-2 py-1 text-[9px] font-semibold" style={{ color: kit.colours.primary }}>
                    {logoPreviewUrl ? <img src={logoPreviewUrl} alt="" /> : brandName}
                  </span>
                  <h5 className="absolute inset-x-2 bottom-9 text-xs font-extrabold">{headlineSample}</h5>
                  <span className="absolute inset-x-2 bottom-2 rounded bg-(--ui-background) py-1 text-center text-[9px] font-bold" style={{ color: kit.colours.primary }}>
                    Book free appraisal
                  </span>
                </div>
                <div className="w-32 overflow-hidden rounded-(--r-card) bg-(--ui-background) text-(--ui-foreground)">
                  <div className="flex items-center gap-1 p-2 text-[9px]">
                    {kit.logos.faviconUrl && <img src={kit.logos.faviconUrl} alt="" />}
                    <b>{brandName}</b>
                  </div>
                  <div className="h-20 bg-(--ui-muted)" />
                  <div className="flex items-center justify-between gap-1 bg-(--ui-muted) p-2 text-[9px]">
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
