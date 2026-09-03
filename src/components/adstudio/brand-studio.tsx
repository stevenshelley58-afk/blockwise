"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Globe2, Plus, Save, X } from "lucide-react";

import { AssetUploadDropzone } from "@/components/asset-upload-dropzone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

/* ------------------------------------------------------------------ */
/* swatch + in-app picker                                              */
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
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const f = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`.toUpperCase();
}

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
        className="size-16 rounded-(--r-card) border border-border shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        style={{ background: value }}
        aria-label={`Edit ${label} colour`}
        onClick={(event) => {
          event.stopPropagation();
          open ? onClose() : onOpen();
        }}
      />
      <span className="text-xs font-semibold">{label}</span>
      <span className="font-mono text-[11px] text-muted-foreground">{value.toUpperCase()}</span>

      {open && (
        <div className="absolute left-1/2 top-20 z-40 grid w-[min(248px,calc(100vw-2rem))] -translate-x-1/2 gap-3 rounded-(--r-card) border border-border bg-popover p-4 text-popover-foreground shadow-float" onClick={(event) => event.stopPropagation()}>
          <div ref={svRef} className="relative aspect-[5/3.4] w-full cursor-crosshair touch-none rounded-(--r-control) bg-[linear-gradient(0deg,#000,transparent),linear-gradient(90deg,#fff,transparent),var(--h,#888)]" style={{ ["--h" as string]: `hsl(${hsv.h},100%,50%)` }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pickFromField(event); }} onPointerMove={(event) => { if (event.buttons === 1) pickFromField(event); }}><span className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} /></div>
          <input className="min-h-11 w-full accent-primary" type="range" min={0} max={360} value={hsv.h} aria-label={`${label} hue`} onChange={(event) => commit({ ...hsv, h: Number(event.target.value) })} />
          {sitePalette.length > 0 && (
            <div className="grid gap-2">
              <span className="text-xs font-semibold text-muted-foreground">From your site</span>
              <div className="flex flex-wrap gap-2">
                {sitePalette.map((colour) => (
                  <button
                    key={colour}
                    type="button"
                    className="size-11 rounded-md border border-border focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    style={{ background: colour }}
                    aria-label={`Use ${colour}`}
                    onClick={() => commit(hexToHsv(colour))}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="flex min-h-11 flex-1 items-center gap-1 rounded-(--r-control) border border-input bg-background px-3 text-sm" htmlFor={`${label.toLowerCase()}-hex-value`}>
              #
              <input
                id={`${label.toLowerCase()}-hex-value`}
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
            </label>
            <Button type="button" size="sm" onClick={onClose}>Done</Button>
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
        <span key={item} className={`inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold ${tone === "no" ? "bg-error-soft text-error" : "bg-muted text-foreground"}`}>
          {item}
          <button type="button" className="grid size-8 place-items-center rounded-full hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label={`Remove ${item}`} onClick={() => onRemove(item)}><X size={14} aria-hidden /></button>
        </span>
      ))}
      {adding ? (
        <Input aria-label="New phrase" className="h-11 min-w-0 rounded-full px-3 text-sm"
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
        <Button type="button" variant="ghost-pill" size="sm" className="min-h-11 border-dashed text-muted-foreground" onClick={() => setAdding(true)}><Plus size={15} aria-hidden /> Add phrase</Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Brand Pack                                                           */
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
    <div className="tw min-h-[calc(100dvh-3.5rem)] bg-background px-4 py-6 font-sans text-foreground md:px-8 md:py-8" aria-label="Brand Pack">
      <div className="mx-auto grid w-full max-w-[720px] gap-6">
        <div className="grid gap-2">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Brand Pack</p>
          <h1 className="font-display text-3xl font-extrabold tracking-[-0.02em] md:text-4xl">Build your Brand Pack</h1>
          <p className="max-w-[65ch] text-sm leading-6 text-muted-foreground">Add your website and we’ll prepare the identity, assets, colours, voice, and compliance details you can review before use.</p>
        </div>
        <Card className="grid gap-5 rounded-(--r-panel) border-border bg-card p-5 shadow-card md:p-7" aria-busy={busy}>
          <Badge variant="secondary" className="w-fit text-muted-foreground">Optional setup</Badge>
          <div className="grid gap-1">
            <h2 className="font-display text-xl font-extrabold tracking-[-0.015em]">Enter your website. We’ll build your brand kit.</h2>
            <p className="text-sm leading-6 text-muted-foreground">One website is enough to get started. You can review every detail before approving it.</p>
          </div>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void scanSite();
            }}
          >
            <Label htmlFor="brand-website">Your website address</Label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Globe2 size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                <Input aria-label="Website address" className="h-11 rounded-(--r-card)"
                id="brand-website"
                value={scanUrl}
                inputMode="url"
                autoComplete="url"
                placeholder="e.g. youragency.com.au"
                onChange={(event) => setScanUrl(event.target.value)}
                />
              </div>
              <Button type="submit" size="lg" disabled={busy}><span>{busy ? "Building your kit…" : "Build my brand kit"}</span><ArrowRight size={16} aria-hidden /></Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">You can skip this and keep generating ads. Add it when you want consistent brand details.</p>
          </form>
          <div className="min-h-6" aria-live="polite" role={notice?.tone === "err" ? "alert" : undefined}>
            {notice ? <p className={`text-sm font-semibold ${notice.tone === "err" ? "text-error" : "text-success"}`}>{notice.text}</p> : null}
          </div>
        </Card>
      </div>
    </div>
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
    <div className="tw min-h-full bg-background font-sans text-foreground" aria-label="Brand Pack">
      <div className="flex min-h-20 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-4 md:px-6">
        <Button variant="ghost-pill" size="sm" asChild><Link href={returnTo}><ArrowLeft size={15} aria-hidden /> Back</Link></Button>
        <div className="grid gap-0.5"><p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Ad Studio</p><h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] md:text-[27px]">Brand Pack</h1></div>
        <Badge variant="secondary" className={approved ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}>{approved ? <><Check size={13} aria-hidden /> Approved</> : "Pending review"}</Badge>
        <div className="ml-auto flex min-h-11 flex-wrap items-center justify-end gap-3 text-sm font-semibold" aria-live="polite">
          {notice && <span role={notice.tone === "err" ? "alert" : undefined} className={`text-sm font-semibold ${notice.tone === "err" ? "text-error" : "text-success"}`}>{notice.text}</span>}
          <Button type="button" size="lg" disabled={busy !== ""} onClick={() => void approveKit()}><Save size={16} aria-hidden /> {busy === "approve" ? "Saving changes…" : "Save changes"}</Button>
        </div>
      </div>

      <div className="min-h-0 overflow-auto">
        <div className="border-b border-border bg-muted/30 px-4 pb-8 pt-6 md:px-8 md:pt-8">
          <div className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">Brand Pack · {kit.identity.marketRegion ?? "AU"}</div>
          <h2 className="font-display text-3xl font-extrabold tracking-[-0.02em] md:text-4xl">
            <input
              className="w-full min-w-0 bg-transparent font-inherit outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
            <span className="text-sm text-muted-foreground">We’ll pull in your logo, colours, fonts, and business details automatically.</span>
            <Label htmlFor="brand-website">Your website address</Label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <span className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-(--r-control) border border-input bg-background px-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9s1.3-6.4 3.8-9z" />
              </svg>
                <Input
                  className="h-11 border-0 bg-transparent shadow-none focus-visible:ring-0"
                  id="brand-website"
                  value={scanUrl}
                  inputMode="url"
                  autoComplete="url"
                  placeholder="e.g. youragency.com.au"
                  onChange={(event) => setScanUrl(event.target.value)}
                />
              </span>
              <Button type="submit" variant="ghost-pill" size="lg" disabled={busy !== ""}>{busy === "scan" ? "Updating your kit…" : "Update from website"}</Button>
            </div>
            <small className="text-muted-foreground">Review and change anything below before you approve it.</small>
          </form>
        </div>

        <div className="mx-auto grid w-full max-w-[1120px] gap-3 px-4 md:px-6 md:grid-cols-3">
          <div className="overflow-hidden rounded-(--r-card) border border-border bg-card shadow-card">
            <div className="grid min-h-24 place-items-center p-4" style={{ background: "#fff", color: kit.colours.primary }}>
              {logoPreviewUrl ? <img src={logoPreviewUrl} alt={`${brandName} primary logo`} /> : <span className="text-xs text-muted-foreground">Not found</span>}
            </div>
            <small className="flex justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
              <b>Primary</b>
              <em>on light</em>
            </small>
          </div>
          <div className="overflow-hidden rounded-(--r-card) border border-border bg-card shadow-card">
            <div className="grid min-h-24 place-items-center p-4" style={{ background: "#16181d", color: "#fff" }}>
              {kit.logos.lightLogoUrl ? (
                <img src={kit.logos.lightLogoUrl} alt={`${brandName} light logo`} />
              ) : (
                <span className="text-xs text-muted-foreground">Not found</span>
              )}
            </div>
            <small className="flex justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
              <b>Dark</b>
              <em>on dark</em>
            </small>
          </div>
          <div className="overflow-hidden rounded-(--r-card) border border-border bg-card shadow-card">
            <div className="grid min-h-24 place-items-center bg-muted p-4 text-background">
              {kit.logos.faviconUrl ? (
                <img src={kit.logos.faviconUrl} alt={`${brandName} brand mark`} />
              ) : (
                <span className="text-xs text-muted-foreground">Not found</span>
              )}
            </div>
            <small className="flex justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
              <b>Mark</b>
              <em>on photo</em>
            </small>
          </div>
        </div>

        <div className="mx-auto grid w-full max-w-[1120px] gap-5 px-4 py-6 pb-28 md:grid-cols-[minmax(0,1fr)_360px] md:px-6 md:pb-16">
          <div className="grid min-w-0 content-start gap-5">
            <Card className="grid gap-4 rounded-(--r-panel) border-border bg-card p-5 shadow-card md:p-6">
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
            </Card>

            <Card className="grid gap-4 rounded-(--r-panel) border-border bg-card p-5 shadow-card md:p-6">
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
              <span className="text-sm text-muted-foreground">Click a swatch to change it — the preview updates as you pick.</span>
            </Card>

            <Card className="grid gap-4 rounded-(--r-panel) border-border bg-card p-5 shadow-card md:p-6">
              <h3>Typography</h3>
              <div className="grid items-center gap-5 sm:grid-cols-[106px_1fr]">
                <div className="grid min-h-24 place-items-center rounded-(--r-card) bg-muted text-5xl font-extrabold">Aa</div>
                <div className="grid min-w-0 gap-4">
                  <div>
                    <Label htmlFor="heading-font">
                      Headings
                      <Input
                        id="heading-font"
                        className="min-h-11 max-w-full rounded-(--r-control) px-3 text-sm"
                        value={kit.typography.headingFont}
                        aria-label="Heading font"
                       onChange={(event) =>
                          setKit((c) => ({ ...c, typography: { ...c.typography, headingFont: event.target.value } }))
                        }
                      />
                    </Label>
                    <span className="font-display text-lg font-extrabold">{headlineSample}</span>
                  </div>
                  <div>
                    <Label htmlFor="body-font">
                      Body
                      <Input
                        id="body-font"
                        className="min-h-11 max-w-full rounded-(--r-control) px-3 text-sm"
                        value={kit.typography.bodyFont}
                        aria-label="Body font"
                        onChange={(event) =>
                          setKit((c) => ({ ...c, typography: { ...c.typography, bodyFont: event.target.value } }))
                        }
                      />
                    </Label>
                    <span className="text-sm text-muted-foreground">
                      Local sales are setting new benchmarks. Get a free, no-pressure appraisal.
                    </span>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="grid gap-4 rounded-(--r-panel) border-border bg-card p-5 shadow-card md:p-6">
              <h3>Voice &amp; tone</h3>
              <div className="grid gap-2">
                <Label htmlFor="brand-voice">
                  How should your ads sound?
                  <span className="ml-2 font-normal text-muted-foreground">
                    {(kit.tone.voice || "").length} / {VOICE_LIMIT}
                  </span>
                </Label>
                <textarea
                  id="brand-voice"
                  className="min-h-24 w-full rounded-(--r-card) border border-input bg-background px-3 py-2.5 text-sm leading-6 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={kit.tone.voice}
                  maxLength={VOICE_LIMIT}
                  rows={3}
                  onChange={(event) => setTone("voice", event.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  {VOICE_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant="ghost-pill"
                      size="sm"
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
                      <Plus size={14} aria-hidden /> {preset}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Use phrases like</Label>
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
                <Label>Never say</Label>
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
            </Card>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="grid gap-4 rounded-(--r-panel) border-border bg-card p-5 shadow-card md:p-6">
                <h3>Identity &amp; contact</h3>
                <div className="grid gap-2">
                  <div className="grid gap-1 border-b border-border pb-2 sm:grid-cols-[84px_1fr] sm:items-center">
                    <Label htmlFor="brand-agency" className="text-sm text-muted-foreground">Agency</Label>
                    <Input id="brand-agency" className="min-h-11 min-w-0 rounded-(--r-control) border-0 px-3 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-ring/50" value={kit.identity.businessName} onChange={(e) => setIdentity("businessName", e.target.value)} />
                  </div>
                  <div className="grid gap-1 border-b border-border pb-2 sm:grid-cols-[84px_1fr] sm:items-center">
                    <Label htmlFor="brand-agent" className="text-sm text-muted-foreground">Agent</Label>
                    <Input id="brand-agent" className="min-h-11 min-w-0 rounded-(--r-control) border-0 px-3 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-ring/50" value={kit.identity.tradingName ?? ""} onChange={(e) => setIdentity("tradingName", e.target.value)} />
                  </div>
                  <div className="grid gap-1 border-b border-border pb-2 sm:grid-cols-[84px_1fr] sm:items-center">
                    <Label htmlFor="brand-phone" className="text-sm text-muted-foreground">Phone</Label>
                    <Input id="brand-phone" type="tel" className="min-h-11 min-w-0 rounded-(--r-control) border-0 px-3 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-ring/50" value={kit.contact.phone ?? ""} onChange={(e) => setContact("phone", e.target.value)} />
                  </div>
                  <div className="grid gap-1 border-b border-border pb-2 sm:grid-cols-[84px_1fr] sm:items-center">
                    <Label htmlFor="brand-email" className="text-sm text-muted-foreground">Email</Label>
                    <Input id="brand-email" type="email" className="min-h-11 min-w-0 rounded-(--r-control) border-0 px-3 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-ring/50" value={kit.contact.email ?? ""} onChange={(e) => setContact("email", e.target.value)} />
                  </div>
                  <div className="grid gap-1 border-b border-border pb-2 sm:grid-cols-[84px_1fr] sm:items-center">
                    <Label htmlFor="brand-region" className="text-sm text-muted-foreground">Region</Label>
                    <Input id="brand-region" className="min-h-11 min-w-0 rounded-(--r-control) border-0 px-3 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-ring/50" value={kit.identity.marketRegion ?? ""} onChange={(e) => setIdentity("marketRegion", e.target.value)} />
                  </div>
                  <div className="grid gap-1 border-b border-border pb-2 sm:grid-cols-[84px_1fr] sm:items-center">
                    <Label htmlFor="brand-licence" className="text-sm text-muted-foreground">Licence</Label>
                    <Input id="brand-licence" className="min-h-11 min-w-0 rounded-(--r-control) border-0 px-3 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-ring/50" value={kit.identity.licenceText ?? ""} onChange={(e) => setIdentity("licenceText", e.target.value)} />
                  </div>
                </div>
              </Card>
              <Card className="grid gap-4 rounded-(--r-panel) border-border bg-card p-5 shadow-card md:p-6">
                <h3>Compliance</h3>
                <div className="grid gap-2">
                  {kit.compliance.disclaimers.map((disclaimer, index) => (
                    <textarea
                      key={index}
                      className="min-h-20 w-full rounded-(--r-card) border border-input bg-background px-3 py-2.5 text-sm leading-6 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      aria-label={`Disclaimer ${index + 1}`}
                      rows={2}
                      value={disclaimer}
                      onChange={(event) => setDisclaimer(index, event.target.value)}
                    />
                  ))}
                  <Button
                    type="button"
                    variant="ghost-pill"
                    size="sm"
                    className="min-h-11 border-dashed text-sm font-semibold text-muted-foreground"
                    onClick={() =>
                      setKit((c) => ({
                        ...c,
                        compliance: { ...c.compliance, disclaimers: [...c.compliance.disclaimers, ""] },
                      }))
                    }
                  >
                    <Plus size={15} aria-hidden /> Add disclaimer
                  </Button>
                </div>
              </Card>
            </div>
          </div>

          <aside className="h-max md:sticky md:top-5">
            <Card className="grid gap-5 rounded-(--r-panel) border-border bg-card p-5 shadow-card md:p-6">
              <div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em]">Live creative preview</h2><p className="mt-1 text-xs text-muted-foreground">Updates as you edit</p></div><Badge variant="secondary">Feed</Badge></div>
              <div className="flex flex-wrap justify-center gap-3">
                <div className="relative aspect-[9/16] w-32 overflow-hidden rounded-(--r-card) bg-muted p-2 text-background">
                  <span className="rounded-full bg-background px-2 py-1 text-[9px] font-semibold" style={{ color: kit.colours.primary }}>
                    {logoPreviewUrl ? <img src={logoPreviewUrl} alt="" className="max-h-5 max-w-full object-contain" /> : brandName}
                  </span>
                  <h5 className="absolute inset-x-2 bottom-9 text-xs font-extrabold">{headlineSample}</h5>
                  <span className="absolute inset-x-2 bottom-2 rounded bg-background py-1 text-center text-[9px] font-bold" style={{ color: kit.colours.primary }}>
                    Book free appraisal
                  </span>
                </div>
                <div className="w-32 overflow-hidden rounded-(--r-card) border border-border bg-background text-foreground">
                  <div className="flex items-center gap-1 p-2 text-[9px]">
                    {kit.logos.faviconUrl && <img src={kit.logos.faviconUrl} alt="" className="size-3 object-contain" />}
                    <b>{brandName}</b>
                  </div>
                  <div className="h-20 bg-muted" />
                  <div className="flex items-center justify-between gap-1 bg-muted p-2 text-[9px]">
                    <b>Free appraisal</b>
                    <span style={{ background: kit.colours.secondary }}>Book</span>
                  </div>
                </div>
              </div>
              <p className="border-t border-border pt-4 text-sm text-muted-foreground">
                Re-renders as you edit — voice line:
                <br />
                <b>{voiceLine || "describe your voice above"}</b>
              </p>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}
