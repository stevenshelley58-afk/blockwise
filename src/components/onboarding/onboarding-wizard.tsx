"use client";

import { ArrowRight, Check, Globe2, Palette, PartyPopper, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Confetti } from "@/components/ui/confetti";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { niche } from "@/config/niche";
import { useReducedMotion } from "@/lib/motion";

type Market = "AU" | "US";
type JsonObject = Record<string, unknown>;

type BrandKitRow = {
  id: string;
  source_url?: string | null;
  business_name?: string | null;
  market_country?: string | null;
  identity_json?: JsonObject | null;
  logos_json?: JsonObject | null;
  colours_json?: JsonObject | null;
  tone_json?: JsonObject | null;
  review_status?: string | null;
};

type BrandPackReview = {
  id: string;
  website: string;
  businessName: string;
  primaryColour: string;
  logoUrl: string | null;
  voice: string;
  reviewStatus: string;
};

type WizardProps = {
  workspaceId: string;
  country: string;
  brandKit: BrandKitRow | null;
  canConfirmMarket: boolean;
};

type ExtractedBrandKit = {
  brandKitId?: string;
  source?: { url?: string };
  identity?: { businessName?: string; marketCountry?: string };
  logos?: { primaryLogoUrl?: string | null };
  colours?: { primary?: string };
  tone?: { voice?: string };
  reviewStatus?: string;
};

const MARKETS: Array<{ value: Market; name: string; currency: string }> = [
  { value: "AU", name: "Australia", currency: "AUD" },
];

export function OnboardingWizard({ workspaceId, country, brandKit, canConfirmMarket }: WizardProps) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const initialReview = brandKit ? reviewFromRow(brandKit) : null;
  const [step, setStep] = useState<"website" | "review">(initialReview ? "review" : "website");
  const [market, setMarket] = useState<Market>(country.toUpperCase() === "US" ? "US" : "AU");
  const [website, setWebsite] = useState(brandKit?.source_url ?? "");
  const [review, setReview] = useState<BrandPackReview | null>(initialReview);
  const [manualName, setManualName] = useState(brandKit?.business_name ?? "");
  const [manualColour, setManualColour] = useState(
    String(brandKit?.colours_json?.primary ?? "#16181d"),
  );
  const [scanFailed, setScanFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!celebrating) return;
    const timer = setTimeout(() => {
      router.push("/ad-studio?first=1");
      router.refresh();
    }, 1200);
    return () => clearTimeout(timer);
  }, [celebrating, router]);

  async function prepareMarket(): Promise<string> {
    const response = await fetch("/api/workspace/onboarding-market", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, country: market, websiteUrl: website }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      websiteUrl?: string;
      error?: string;
    };
    if (!response.ok || !payload.websiteUrl) {
      throw new Error(payload.error ?? "We couldn't save your website and country.");
    }
    return payload.websiteUrl;
  }

  async function scanWebsite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setScanFailed(false);
    try {
      const normalizedWebsite = await prepareMarket();
      await extractBrandPack(normalizedWebsite);
    } catch (error) {
      setScanFailed(true);
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "We couldn't scan that website. Your address is still here, and you can retry or add the essentials.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function createManualBrandPack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const normalizedWebsite = await prepareMarket();
      const safeName = escapeHtml(manualName.trim());
      const safeColour = /^#[0-9a-f]{6}$/i.test(manualColour) ? manualColour : "#16181d";
      await extractBrandPack(
        normalizedWebsite,
        `<!doctype html><html><head><title>${safeName}</title><style>:root{--brand:${safeColour}} body{color:${safeColour}}</style></head><body><h1>${safeName}</h1></body></html>`,
      );
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "We couldn't save those Brand Pack essentials.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function extractBrandPack(normalizedWebsite: string, html?: string) {
    const response = await fetch("/api/adstudio/brand-kits/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        websiteUrl: normalizedWebsite,
        marketCountry: market,
        marketRegion: market,
        ...(html ? { html } : {}),
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      brandKit?: ExtractedBrandKit;
      data?: ExtractedBrandKit;
      error?: string;
    };
    const extracted = payload.brandKit ?? payload.data;
    if (!response.ok || !extracted?.brandKitId) {
      throw new Error(
        payload.error ??
          "We couldn't scan that website. Your address is still here, and you can retry or add the essentials.",
      );
    }
    const nextReview = reviewFromExtracted(extracted, normalizedWebsite);
    setWebsite(normalizedWebsite);
    setReview(nextReview);
    setStep("review");
    setScanFailed(false);
    setMessage({ tone: "success", text: "Brand Pack ready for your review." });
  }

  async function approveBrandPack() {
    if (!review) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/adstudio/brand-kits/${encodeURIComponent(review.id)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "We couldn't approve this Brand Pack.");
      }
      if (reducedMotion) {
        router.push("/ad-studio?first=1");
        router.refresh();
      } else {
        setCelebrating(true);
      }
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "We couldn't approve this Brand Pack.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!canConfirmMarket) {
    return (
      <section className="rounded-(--r-panel) border border-(--line) bg-(--surface) p-6 shadow-card">
        <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em]">
          An owner or admin needs to confirm the workspace
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          You can keep using the rest of Blockwise while they add the website and billing country.
        </p>
        <Button asChild className="mt-5">
          <Link href="/self-serve">Open workspace</Link>
        </Button>
      </section>
    );
  }

  return (
    <section className="grid gap-5">
      <div>
        <ol aria-label="Brand Pack setup steps" className="grid grid-cols-2 gap-2">
          {[
            { id: "website", label: "Website and country" },
            { id: "review", label: "Review Brand Pack" },
          ].map((item, index) => {
            const active = item.id === step;
            const complete = step === "review" && index === 0;
            return (
              <li
                key={item.id}
                aria-current={active ? "step" : undefined}
                className={`flex min-h-11 items-center gap-2 rounded-(--r-card) border px-3 text-[12.5px] font-bold ${
                  active ? "border-(--ink) bg-(--surface)" : "border-(--line) bg-(--surface-subtle)"
                }`}
              >
                <span
                  className={`grid size-6 place-items-center rounded-full text-[11px] ${
                    complete ? "bg-success-soft text-success" : active ? "bg-(--ink) text-white" : "bg-card text-(--faint)"
                  }`}
                >
                  {complete ? <Check size={13} aria-hidden /> : index + 1}
                </span>
                {item.label}
              </li>
            );
          })}
        </ol>
      </div>

      {step === "website" ? (
        <div className="rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card sm:p-6">
          <form className="grid gap-5" onSubmit={scanWebsite}>
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--accent-tint)">
                <Globe2 size={19} aria-hidden />
              </span>
              <div>
                <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em]">
                  Start with your website
                </h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  We’ll draft one Brand Pack from your public site. You review it before it is used.
                </p>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="onboarding-website">Business website</Label>
              <Input
                id="onboarding-website"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://yourbusiness.com"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                required
              />
            </div>

            <fieldset className="grid gap-2">
              <legend className="text-[12.5px] font-semibold">Country and billing currency</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {MARKETS.map((item) => (
                  <label
                    key={item.value}
                    className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-(--r-card) border px-4 ${
                      market === item.value
                        ? "border-(--ink) bg-(--surface-subtle)"
                        : "border-(--line) bg-(--surface)"
                    }`}
                  >
                    <input
                      type="radio"
                      name="market"
                      value={item.value}
                      checked={market === item.value}
                      onChange={() => setMarket(item.value)}
                    />
                    <span className="grid">
                      <span className="text-[13px] font-bold">{item.name}</span>
                      <span className="text-xs text-muted-foreground">{item.currency} billing</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                After Checkout or Meta connection, country changes need an assisted workspace migration.
              </p>
            </fieldset>

            {message ? <Feedback message={message} /> : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link className="min-h-11 py-3 text-[12.5px] font-bold underline-offset-4 hover:underline" href="/self-serve">
                Finish later
              </Link>
              <Button type="submit" disabled={busy}>
                {busy ? "Scanning website…" : "Create my Brand Pack"} <ArrowRight size={16} aria-hidden />
              </Button>
            </div>
          </form>

          {scanFailed ? (
            <form
              className="mt-5 grid gap-4 rounded-(--r-card) border border-(--line-heavy) bg-(--surface-subtle) p-4"
              onSubmit={createManualBrandPack}
            >
              <div>
                <h3 className="text-[13px] font-bold">Add the essentials instead</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Keep the website above and add only what we need to create a reviewable Brand Pack.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <div className="grid gap-2">
                  <Label htmlFor="manual-business-name">Business name</Label>
                  <Input
                    id="manual-business-name"
                    value={manualName}
                    onChange={(event) => setManualName(event.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="manual-primary-colour">Primary colour</Label>
                  <input
                    id="manual-primary-colour"
                    type="color"
                    className="size-11 cursor-pointer rounded-(--r-card) border border-(--line-heavy) bg-card p-1"
                    value={manualColour}
                    onChange={(event) => setManualColour(event.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" type="button" disabled={busy} onClick={() => setScanFailed(false)}>
                  <RotateCcw size={15} aria-hidden /> Retry scan
                </Button>
                <Button type="submit" disabled={busy || !manualName.trim()}>
                  {busy ? "Saving…" : "Create essentials"}
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      {step === "review" && review ? (
        <div className="rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success-soft text-success">
              <Palette size={19} aria-hidden />
            </span>
            <div>
              <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em]">
                Review your Brand Pack
              </h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Confirm the extracted identity before Blockwise uses it in an ad.
              </p>
            </div>
          </div>

          <dl className="mt-5 grid gap-px overflow-hidden rounded-(--r-card) border border-(--line) bg-(--line) sm:grid-cols-2">
            <ReviewItem label="Business" value={review.businessName || "Needs your review"} />
            <ReviewItem label="Website" value={review.website} />
            <ReviewItem
              label="Primary colour"
              value={
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-4 rounded-full border border-black/10"
                    style={{ backgroundColor: review.primaryColour }}
                  />
                  {review.primaryColour}
                </span>
              }
            />
            <ReviewItem label="Brand voice" value={review.voice || "Professional and clear"} />
          </dl>

          {message ? <div className="mt-4"><Feedback message={message} /></div> : null}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" type="button" disabled={busy} onClick={() => setStep("website")}>
              Change website or country
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link href="/ad-studio/brand">Review all details</Link>
              </Button>
              <Button type="button" disabled={busy} onClick={approveBrandPack}>
                {busy ? "Approving…" : "Approve and choose an ad"} <ArrowRight size={16} aria-hidden />
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {celebrating ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-(--ink)/40 px-6 backdrop-blur-[2px]">
          <Confetti
            className="pointer-events-none absolute inset-0"
            options={{
              particleCount: 120,
              spread: 70,
              startVelocity: 30,
              origin: { y: 0.55 },
              colors: [niche.theme.data, "#16181d", "#9aa0ad"],
            }}
          />
          <div className="relative rounded-(--r-panel) border border-(--line) bg-(--surface) px-9 py-7 text-center shadow-float">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-success-soft text-success">
              <PartyPopper size={22} aria-hidden />
            </span>
            <h2 className="mt-3 font-display text-[17px] font-extrabold tracking-[-0.015em]">
              Brand Pack approved
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Opening Ad Studio…</p>
            <Link
              className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-bold underline-offset-4 hover:underline"
              href="/connect-meta"
            >
              Connect your Meta ad account <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Feedback({ message }: { message: { tone: "success" | "error"; text: string } }) {
  return (
    <p
      role={message.tone === "error" ? "alert" : "status"}
      className={`text-[12.5px] font-bold ${message.tone === "error" ? "text-error" : "text-success"}`}
    >
      {message.text}
    </p>
  );
}

function ReviewItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-(--surface-subtle) p-4">
      <dt className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
        {label}
      </dt>
      <dd className="mt-1 break-words text-[13px] font-bold">{value}</dd>
    </div>
  );
}

function reviewFromRow(row: BrandKitRow): BrandPackReview {
  return {
    id: row.id,
    website: row.source_url ?? "",
    businessName: String(row.identity_json?.businessName ?? row.business_name ?? ""),
    primaryColour: String(row.colours_json?.primary ?? "#16181d"),
    logoUrl: typeof row.logos_json?.primaryLogoUrl === "string" ? row.logos_json.primaryLogoUrl : null,
    voice: String(row.tone_json?.voice ?? ""),
    reviewStatus: row.review_status ?? "pending_user_review",
  };
}

function reviewFromExtracted(brandKit: ExtractedBrandKit, website: string): BrandPackReview {
  return {
    id: brandKit.brandKitId ?? "",
    website: brandKit.source?.url ?? website,
    businessName: brandKit.identity?.businessName ?? "",
    primaryColour: brandKit.colours?.primary ?? "#16181d",
    logoUrl: brandKit.logos?.primaryLogoUrl ?? null,
    voice: brandKit.tone?.voice ?? "",
    reviewStatus: brandKit.reviewStatus ?? "pending_user_review",
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
