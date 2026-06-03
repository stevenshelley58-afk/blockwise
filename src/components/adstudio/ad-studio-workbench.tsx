"use client";

import {
  Archive,
  BadgeCheck,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  Cloud,
  Copy,
  Download,
  Globe2,
  Home,
  Image as ImageIcon,
  Link2,
  MapPin,
  Megaphone,
  Minus,
  Monitor,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Share2,
  ShieldCheck,
  Smartphone,
  Target,
  Trash2,
  Type,
  UsersRound,
  Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioGoal,
  AdStudioOfferTemplate,
  AdStudioPlatformCopyPack,
  MetaLeadAdPack,
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

type StudioSection =
  | "campaign"
  | "angles"
  | "brand"
  | "media"
  | "copy"
  | "audience"
  | "landing"
  | "publish"
  | "settings";
type InspectorTab = "edit" | "publish";
type PreviewFormat = "story" | "feed" | "square" | "landscape";
type SelectedElement = "headline" | "primaryText" | "description" | "cta" | "image";
type SaveState = "saved" | "saving" | "error";

type CopyState = {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
};

type AngleCard = {
  id: string;
  name: string;
  purpose: string;
  bestFor: string;
  goal: AdStudioGoal;
  offerId: string;
  variantLabel: string;
};

type ReadinessItem = {
  label: string;
  detail: string;
  state: "done" | "warn" | "todo";
};

const NAV_ITEMS: Array<{ id: StudioSection; label: string; icon: LucideIcon }> = [
  { id: "campaign", label: "Campaign", icon: Target },
  { id: "angles", label: "Angles", icon: Wand2 },
  { id: "brand", label: "Brand", icon: ShieldCheck },
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "copy", label: "Copy", icon: Type },
  { id: "audience", label: "Audience", icon: UsersRound },
  { id: "landing", label: "Landing", icon: Link2 },
  { id: "publish", label: "Publish", icon: Send },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const MOBILE_NAV: Array<{ id: "campaign" | "variants" | "checklist" | "publish"; label: string; icon: LucideIcon }> = [
  { id: "campaign", label: "Campaign", icon: Target },
  { id: "variants", label: "Variants", icon: Copy },
  { id: "checklist", label: "Checklist", icon: BadgeCheck },
  { id: "publish", label: "Publish", icon: Send },
];

const ANGLES: AngleCard[] = [
  {
    id: "free_appraisal",
    name: "Free Appraisal",
    purpose: "Direct seller lead capture",
    bestFor: "appraisal enquiries",
    goal: "appraisal_bookings",
    offerId: "home_value_update",
    variantLabel: "Direct appraisal",
  },
  {
    id: "buyer_demand",
    name: "Buyer Demand",
    purpose: "Show active demand without over-claiming",
    bestFor: "vendor leads",
    goal: "seller_leads",
    offerId: "home_value_update",
    variantLabel: "Buyer demand",
  },
  {
    id: "recent_sale",
    name: "Recent Sale",
    purpose: "Turn local proof into seller interest",
    bestFor: "warm owners",
    goal: "seller_leads",
    offerId: "recent_sales_report",
    variantLabel: "Recent activity",
  },
  {
    id: "market_update",
    name: "Market Update",
    purpose: "Useful local market report offer",
    bestFor: "passive owners",
    goal: "market_update_leads",
    offerId: "suburb_market_report",
    variantLabel: "Market update",
  },
  {
    id: "open_home",
    name: "Open Home",
    purpose: "Promote inspection interest",
    bestFor: "open homes",
    goal: "open_home_followup",
    offerId: "open_home_followup",
    variantLabel: "Open home",
  },
  {
    id: "low_stock",
    name: "Low Stock",
    purpose: "Create urgency from market context",
    bestFor: "seller intent",
    goal: "seller_leads",
    offerId: "seller_prep_checklist",
    variantLabel: "Low stock",
  },
  {
    id: "home_values",
    name: "Home Values",
    purpose: "Prompt owners to check value",
    bestFor: "home value leads",
    goal: "appraisal_bookings",
    offerId: "home_value_update",
    variantLabel: "Home value angle",
  },
  {
    id: "investor_update",
    name: "Investor Update",
    purpose: "Local snapshot for investors",
    bestFor: "investor leads",
    goal: "investor_leads",
    offerId: "investor_suburb_snapshot",
    variantLabel: "Investor update",
  },
];

const FORMAT_META: Record<
  PreviewFormat,
  { label: string; size: string; kind: "story" | "feed" | "landscape"; imageClass: string }
> = {
  story: { label: "Story", size: "1080x1920", kind: "story", imageClass: "studio-story-frame" },
  feed: { label: "Feed", size: "1080x1080", kind: "feed", imageClass: "studio-feed-frame" },
  square: { label: "Square", size: "1080x1080", kind: "feed", imageClass: "studio-square-frame" },
  landscape: { label: "Landscape", size: "1200x628", kind: "landscape", imageClass: "studio-landscape-frame" },
};

const MEDIA_ASSETS = [
  { src: "/ads/ad-northstar.jpg", label: "South Perth skyline", type: "Uploaded", ratio: "Story" },
  { src: "/ads/ad-hillview.jpg", label: "Modern family home", type: "Property image", ratio: "Feed" },
  { src: "/ads/ad-hillco.jpg", label: "Living room hero", type: "Brand asset", ratio: "Square" },
  { src: "/ads/ad-coastline.jpg", label: "River market view", type: "Previously used", ratio: "Landscape" },
];

const COPY_LIMITS: Record<keyof CopyState, number> = {
  primaryText: 125,
  headline: 40,
  description: 90,
  cta: 24,
};

function hostOf(url: string): string {
  try {
    const host = new URL(url).host.replace(/^www\./, "");
    return host.endsWith(".example") ? "northstarrealty.com.au" : host;
  } catch {
    return "northstarrealty.com.au";
  }
}

function getCopyPack(pack: AdStudioCampaignPack, variantId: string): AdStudioPlatformCopyPack | undefined {
  return pack.copyPacks.find((copyPack) => copyPack.variantId === variantId) ?? pack.copyPacks[0];
}

function labelForCta(cta: MetaLeadAdPack["cta"] | string | undefined): string {
  if (cta === "SIGN_UP") return "Sign up";
  if (cta === "DOWNLOAD") return "Download";
  if (cta === "CONTACT_US") return "Contact us";
  return "Learn more";
}

function toMetaCta(label: string): MetaLeadAdPack["cta"] {
  const normalised = label.trim().toLowerCase();
  if (normalised.includes("download")) return "DOWNLOAD";
  if (normalised.includes("contact") || normalised.includes("book")) return "CONTACT_US";
  if (normalised.includes("sign")) return "SIGN_UP";
  return "LEARN_MORE";
}

function seedCopy(pack: AdStudioCampaignPack, variantIndex = 0): CopyState {
  const variant = pack.variants[variantIndex] ?? pack.variants[0];
  const copyPack = variant ? getCopyPack(pack, variant.variantId) : pack.copyPacks[0];
  const meta = copyPack?.meta;

  return {
    primaryText:
      meta?.primaryText?.[0] ??
      "Thinking about selling? See what your home could be worth with local guidance and no pressure.",
    headline: meta?.headlines?.[0] ?? variant?.headline ?? "What's Your Home Worth in South Perth?",
    description: meta?.descriptions?.[0] ?? "Free appraisal. No commitment.",
    cta: labelForCta(meta?.cta ?? variant?.cta),
  };
}

function getMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Ad Studio request failed.";
}

export function AdStudioWorkbench({
  brandKit,
  campaignPack: initialPack,
  offers,
  performance,
}: AdStudioWorkbenchProps) {
  const [pack, setPack] = useState(initialPack);
  const [section, setSection] = useState<StudioSection>("campaign");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("publish");
  const [selectedAngleId, setSelectedAngleId] = useState("free_appraisal");
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>("story");
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [zoom, setZoom] = useState(75);
  const [copy, setCopy] = useState<CopyState>(() => seedCopy(initialPack));
  const [selectedElement, setSelectedElement] = useState<SelectedElement>("headline");
  const [primaryImage, setPrimaryImage] = useState(MEDIA_ASSETS[0].src);
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("Generating variants");
  const [toast, setToast] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [mobileTab, setMobileTab] = useState<"campaign" | "variants" | "checklist" | "publish">("campaign");
  const [campaignGoal, setCampaignGoal] = useState("Get appraisal leads");
  const [offerLabel, setOfferLabel] = useState("Free appraisal");
  const [market, setMarket] = useState("South Perth, WA");
  const [propertyType, setPropertyType] = useState("Houses");
  const [leadDestination, setLeadDestination] = useState("Landing page");
  const [destinationUrl, setDestinationUrl] = useState("northstarrealty.com.au/free-appraisal");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const brand = brandKit.identity.businessName || "Northstar Realty";
  const initials = brand.charAt(0).toUpperCase();
  const domain = hostOf(brandKit.source.url);
  const selectedAngle = ANGLES.find((angle) => angle.id === selectedAngleId) ?? ANGLES[0];
  const currentVariant = pack.variants[selectedVariantIndex] ?? pack.variants[0];
  const format = FORMAT_META[previewFormat];
  const campaignName = "Free Appraisal Campaign";

  const variants = useMemo(() => {
    const source = pack.variants.length > 0 ? pack.variants : initialPack.variants;
    return source.slice(0, 4).map((variant, index) => ({
      ...variant,
      displayName: `Variant ${String.fromCharCode(65 + index)}`,
      angleLabel: index === 0 ? selectedAngle.variantLabel : ANGLES[(index + 6) % ANGLES.length].variantLabel,
      image: MEDIA_ASSETS[index % MEDIA_ASSETS.length].src,
    }));
  }, [initialPack.variants, pack.variants, selectedAngle.variantLabel]);

  const readinessItems = useMemo<ReadinessItem[]>(() => {
    return [
      { label: "Goal & offer", detail: `${campaignGoal} / ${offerLabel}`, state: campaignGoal && offerLabel ? "done" : "todo" },
      { label: "Location", detail: market, state: market ? "done" : "todo" },
      { label: "Property type", detail: propertyType, state: propertyType ? "done" : "todo" },
      { label: "Landing page", detail: destinationUrl || "Add destination URL", state: destinationUrl ? "done" : "todo" },
      { label: "Primary media", detail: primaryImage ? "Image uploaded" : "Upload image", state: primaryImage ? "done" : "todo" },
      { label: "Ad copy", detail: copy.headline ? "Copy could be more specific" : "Add primary headline", state: copy.headline ? "warn" : "todo" },
      { label: "Call to action", detail: copy.cta ? copy.cta : "Add CTA", state: copy.cta ? "warn" : "todo" },
      {
        label: "Compliance",
        detail: pack.compliance.status === "approved" ? "Checked" : "Needs review",
        state: pack.compliance.status === "blocked" ? "todo" : "done",
      },
    ];
  }, [campaignGoal, copy.cta, copy.headline, destinationUrl, market, offerLabel, pack.compliance.status, primaryImage, propertyType]);

  const readinessScore = useMemo(() => {
    if (!destinationUrl) return 68;
    if (readinessItems.some((item) => item.state === "todo")) return 74;
    return 82;
  }, [destinationUrl, readinessItems]);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }

  function selectVariant(index: number) {
    setSelectedVariantIndex(index);
    setCopy(seedCopy(pack, index));
    setPrimaryImage(MEDIA_ASSETS[index % MEDIA_ASSETS.length].src);
  }

  async function postJson<T>(url: string, body: Record<string, unknown>, method = "POST"): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error ?? `Request failed with ${response.status}.`);
    }

    return payload as T;
  }

  function parseMarket() {
    const [suburbPart, statePart] = market.split(",").map((part) => part.trim());
    return {
      suburb: suburbPart || pack.campaign.market.suburb || "South Perth",
      state: statePart || pack.campaign.market.state || "WA",
      city: pack.campaign.market.city || "Perth",
    };
  }

  function offerExists(offerId: string) {
    return offers.some((offer) => offer.offerId === offerId);
  }

  async function generateVariantsForAngle(angle: AngleCard) {
    setSelectedAngleId(angle.id);
    setSection("angles");
    setBusy(true);
    setBusyMessage(`Generating ${angle.name} variants`);
    setOfferLabel(angle.name === "Free Appraisal" ? "Free appraisal" : angle.name);

    try {
      const parsedMarket = parseMarket();
      const payload = await postJson<{ campaignPack: AdStudioCampaignPack }>("/api/adstudio/campaigns", {
        brandKit,
        goal: angle.goal,
        suburb: parsedMarket.suburb,
        city: parsedMarket.city,
        state: parsedMarket.state,
        offerId: offerExists(angle.offerId) ? angle.offerId : offers[0]?.offerId,
        platforms: ["meta"],
        variantCount: 3,
      });

      setPack(payload.campaignPack);
      setSelectedVariantIndex(0);
      setCopy(seedCopy(payload.campaignPack));
      setPrimaryImage(MEDIA_ASSETS[0].src);
      setSaveState("saved");
      showToast("Generated 3 variants");
    } catch (error) {
      showToast(getMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function buildCurrentPack(): AdStudioCampaignPack {
    const variantId = currentVariant?.variantId;

    if (!variantId) return pack;

    return {
      ...pack,
      variants: pack.variants.map((variant) =>
        variant.variantId === variantId
          ? {
              ...variant,
              headline: copy.headline,
              offer: offerLabel,
              cta: copy.cta,
            }
          : variant,
      ),
      copyPacks: pack.copyPacks.map((copyPack) => {
        if (copyPack.variantId !== variantId) return copyPack;

        return {
          ...copyPack,
          meta: {
            ...copyPack.meta,
            primaryText: [copy.primaryText, ...copyPack.meta.primaryText.slice(1)],
            headlines: [copy.headline, ...copyPack.meta.headlines.slice(1)],
            descriptions: [copy.description, ...copyPack.meta.descriptions.slice(1)],
            cta: toMetaCta(copy.cta),
          },
          landingPage: {
            ...copyPack.landingPage,
            headline: copy.headline,
            subheadline: copy.description,
            cta: copy.cta,
          },
        };
      }),
    };
  }

  async function saveDraft() {
    setSaveState("saving");
    setSaveError("");

    try {
      const currentPack = buildCurrentPack();
      const payload = await postJson<{ campaignPack: AdStudioCampaignPack }>(
        `/api/adstudio/campaigns/${currentPack.campaign.campaignId}/draft`,
        { campaignPack: currentPack },
        "PATCH",
      );
      setPack(payload.campaignPack);
      setSaveState("saved");
      showToast("Draft saved");
    } catch (error) {
      const message = getMessage(error);
      setSaveError(message);
      setSaveState("error");
      showToast(message);
    }
  }

  async function exportCreatives() {
    setBusy(true);
    setBusyMessage("Preparing creative export");

    try {
      const currentPack = buildCurrentPack();
      const response = await fetch(`/api/adstudio/export-packages/${currentPack.campaign.campaignId}/download`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignPack: currentPack }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Export failed." }));
        throw new Error(payload.error ?? "Export failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "free-appraisal-campaign-creatives.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("Creative export downloaded");
    } catch (error) {
      showToast(getMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function replaceImage(files: FileList | null) {
    const file = files?.[0];
    if (!file || !file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setPrimaryImage(String(event.target?.result ?? MEDIA_ASSETS[0].src));
      setSelectedElement("image");
      setInspectorTab("edit");
      showToast("Image replaced");
    };
    reader.readAsDataURL(file);
  }

  function updateCopy(key: keyof CopyState, value: string) {
    setCopy((current) => ({ ...current, [key]: value }));
    setSelectedElement(key);
    setSaveState("saving");
    window.setTimeout(() => setSaveState("saved"), 650);
  }

  function applyCopyAssist(action: string) {
    if (action === "Make more local") {
      updateCopy("primaryText", `South Perth homeowners: ${copy.primaryText.replace(/^South Perth homeowners:\s*/i, "")}`);
    } else if (action === "Make more direct") {
      updateCopy("headline", "What's Your Home Worth in South Perth?");
    } else if (action === "Reduce hype") {
      updateCopy("description", "Free appraisal. No pressure, no commitment.");
    } else {
      updateCopy("headline", copy.headline.replace(/\?*$/, "?"));
    }
    showToast(action);
  }

  const publishBlocker = destinationUrl ? "" : "Publish blocked: Landing URL is missing.";
  const statusText = saveState === "saving" ? "Saving..." : saveState === "error" ? `Could not save: ${saveError}` : "Saved just now";

  return (
    <main className="studio-screen" aria-label="Ad Studio workspace">
      <style>{STYLES}</style>
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(event) => replaceImage(event.target.files)} />

      <header className="studio-topbar">
        <div className="studio-titlebar">
          <BlockwiseLogo />
          <span className="studio-divider" />
          <span className="studio-breadcrumb">Ad Studio / {campaignName}</span>
          <ChevronDown aria-hidden size={16} />
        </div>
        <div className="studio-mobile-title">
          <BlockwiseLogo />
          <span className="studio-divider" />
          <strong>Ad Studio</strong>
        </div>
        <div className="studio-actions">
          <button className="studio-btn secondary" type="button" onClick={saveDraft}>
            <Cloud aria-hidden size={17} />
            Save
          </button>
          <button className="studio-btn publish" type="button" onClick={() => setInspectorTab("publish")}>
            <Send aria-hidden size={17} />
            Publish
          </button>
          <button className="studio-icon-btn" type="button" aria-label="More actions" onClick={() => setShowMore((value) => !value)}>
            <MoreHorizontal aria-hidden size={20} />
          </button>
        </div>

        {showMore && (
          <div className="studio-more-menu">
            <button type="button">
              <Copy aria-hidden size={16} />
              Duplicate campaign
            </button>
            <button type="button" onClick={exportCreatives}>
              <Download aria-hidden size={16} />
              Export creatives
              <ChevronRight aria-hidden size={15} />
            </button>
            <button type="button">
              <Share2 aria-hidden size={16} />
              Share for review
            </button>
            <button type="button">
              <BadgeCheck aria-hidden size={16} />
              Send for approval
            </button>
            <span className="studio-menu-line" />
            <button type="button">
              <Archive aria-hidden size={16} />
              Archive campaign
            </button>
            <button className="danger" type="button">
              <Trash2 aria-hidden size={16} />
              Delete campaign
            </button>
          </div>
        )}
      </header>

      <div className="studio-desktop-body">
        <aside className="studio-rail" aria-label="Ad Studio sections">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={section === item.id ? "active" : ""}
                key={item.id}
                type="button"
                onClick={() => {
                  setSection(item.id);
                  if (item.id === "publish") setInspectorTab("publish");
                }}
              >
                <Icon aria-hidden size={19} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </aside>

        <section className="studio-left-panel" aria-label={`${section} setup`}>
          <PanelContent
            section={section}
            angles={ANGLES}
            selectedAngleId={selectedAngleId}
            campaignGoal={campaignGoal}
            setCampaignGoal={setCampaignGoal}
            offerLabel={offerLabel}
            setOfferLabel={setOfferLabel}
            market={market}
            setMarket={setMarket}
            propertyType={propertyType}
            setPropertyType={setPropertyType}
            leadDestination={leadDestination}
            setLeadDestination={setLeadDestination}
            destinationUrl={destinationUrl}
            setDestinationUrl={setDestinationUrl}
            brand={brand}
            brandKit={brandKit}
            copy={copy}
            updateCopy={updateCopy}
            primaryImage={primaryImage}
            openFilePicker={() => fileInputRef.current?.click()}
            onGenerate={generateVariantsForAngle}
          />
        </section>

        <section className="studio-preview-column" aria-label="Ad preview">
          <PreviewControls
            previewFormat={previewFormat}
            setPreviewFormat={setPreviewFormat}
            zoom={zoom}
            setZoom={setZoom}
            device={device}
            setDevice={setDevice}
          />

          <div className="studio-stage">
            <AdPreview
              brand={brand}
              domain={domain}
              initials={initials}
              copy={copy}
              image={primaryImage}
              format={previewFormat}
              zoom={zoom}
              selectedElement={selectedElement}
              setSelectedElement={(element) => {
                setSelectedElement(element);
                setInspectorTab("edit");
              }}
            />
            {busy && (
              <div className="studio-busy">
                <div className="studio-busy-card">
                  <RefreshCw aria-hidden size={22} />
                  <strong>{busyMessage}</strong>
                  <span>No changes were made until generation completes.</span>
                </div>
              </div>
            )}
          </div>

          <VariantStrip variants={variants} selectedVariantIndex={selectedVariantIndex} onSelect={selectVariant} />
        </section>

        <aside className="studio-inspector" aria-label="Campaign inspector">
          <Inspector
            tab={inspectorTab}
            setTab={setInspectorTab}
            readinessScore={readinessScore}
            readinessItems={readinessItems}
            selectedElement={selectedElement}
            copy={copy}
            updateCopy={updateCopy}
            openFilePicker={() => fileInputRef.current?.click()}
            applyCopyAssist={applyCopyAssist}
            destinationUrl={destinationUrl}
            publishBlocker={publishBlocker}
            onExport={exportCreatives}
          />
        </aside>
      </div>

      <div className="studio-mobile-body">
        <div className="studio-mobile-campaign">
          <button className="studio-mobile-campaign-btn" type="button">
            <Target aria-hidden size={18} />
            {campaignName}
            <ChevronDown aria-hidden size={16} />
          </button>
        </div>

        <div className="studio-mobile-format-tabs">
          {(["story", "feed", "square"] as PreviewFormat[]).map((item) => (
            <button className={previewFormat === item ? "active" : ""} key={item} type="button" onClick={() => setPreviewFormat(item)}>
              {FORMAT_META[item].label}
            </button>
          ))}
        </div>

        {mobileTab === "campaign" && (
          <div className="studio-mobile-preview-wrap">
            <AdPreview
              brand={brand}
              domain={domain}
              initials={initials}
              copy={copy}
              image={primaryImage}
              format={previewFormat}
              zoom={100}
              selectedElement={selectedElement}
              setSelectedElement={(element) => {
                setSelectedElement(element);
                setMobileTab("checklist");
              }}
            />
          </div>
        )}

        {mobileTab === "variants" && (
          <div className="studio-mobile-panel">
            <VariantStrip variants={variants} selectedVariantIndex={selectedVariantIndex} onSelect={selectVariant} />
            <button className="studio-btn publish block" type="button" onClick={() => generateVariantsForAngle(selectedAngle)}>
              <Wand2 aria-hidden size={17} />
              Generate variants
            </button>
          </div>
        )}

        {mobileTab === "checklist" && (
          <div className="studio-mobile-panel">
            <ReadinessCard score={readinessScore} items={readinessItems} compact={false} />
          </div>
        )}

        {mobileTab === "publish" && (
          <div className="studio-mobile-panel">
            <PublishPanel destinationUrl={destinationUrl} blocker={publishBlocker} onExport={exportCreatives} />
          </div>
        )}

        <div className="studio-mobile-variants">
          <VariantStrip variants={variants} selectedVariantIndex={selectedVariantIndex} onSelect={selectVariant} compact />
        </div>

        <ReadinessCard score={readinessScore} items={readinessItems.slice(0, 4)} compact />
      </div>

      <footer className="studio-statusbar">
        <span className={saveState === "error" ? "error" : ""}>{statusText}</span>
        <span>{format.label} | {format.size}</span>
        <span>In-feed preview</span>
      </footer>

      <nav className="studio-mobile-bottom" aria-label="Ad Studio mobile navigation">
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <button className={mobileTab === item.id ? "active" : ""} key={item.id} type="button" onClick={() => setMobileTab(item.id)}>
              <Icon aria-hidden size={22} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {toast && <div className="studio-toast">{toast}</div>}
    </main>
  );
}

function PanelContent({
  section,
  angles,
  selectedAngleId,
  campaignGoal,
  setCampaignGoal,
  offerLabel,
  setOfferLabel,
  market,
  setMarket,
  propertyType,
  setPropertyType,
  leadDestination,
  setLeadDestination,
  destinationUrl,
  setDestinationUrl,
  brand,
  brandKit,
  copy,
  updateCopy,
  primaryImage,
  openFilePicker,
  onGenerate,
}: {
  section: StudioSection;
  angles: AngleCard[];
  selectedAngleId: string;
  campaignGoal: string;
  setCampaignGoal: (value: string) => void;
  offerLabel: string;
  setOfferLabel: (value: string) => void;
  market: string;
  setMarket: (value: string) => void;
  propertyType: string;
  setPropertyType: (value: string) => void;
  leadDestination: string;
  setLeadDestination: (value: string) => void;
  destinationUrl: string;
  setDestinationUrl: (value: string) => void;
  brand: string;
  brandKit: AdStudioBrandKit;
  copy: CopyState;
  updateCopy: (key: keyof CopyState, value: string) => void;
  primaryImage: string;
  openFilePicker: () => void;
  onGenerate: (angle: AngleCard) => void;
}) {
  if (section === "angles") {
    return (
      <>
        <PanelHeader title="Angles" detail="Choose the marketing angle before variants are generated." />
        <div className="studio-angle-list">
          {angles.map((angle, index) => (
            <button
              className={selectedAngleId === angle.id ? "studio-angle-card active" : "studio-angle-card"}
              key={angle.id}
              type="button"
              onClick={() => onGenerate(angle)}
            >
              <span className="studio-angle-thumb" style={{ backgroundImage: `url(${MEDIA_ASSETS[index % MEDIA_ASSETS.length].src})` }} />
              <span>
                <strong>{angle.name}</strong>
                <small>{angle.purpose}</small>
                <em>Best for: {angle.bestFor}</em>
              </span>
            </button>
          ))}
        </div>
        <button className="studio-btn publish block" type="button" onClick={() => onGenerate(angles.find((angle) => angle.id === selectedAngleId) ?? angles[0])}>
          <Wand2 aria-hidden size={17} />
          Generate variants
        </button>
      </>
    );
  }

  if (section === "brand") {
    return (
      <>
        <PanelHeader title="Brand" detail="Approved brand kit controls the creative guardrails." />
        <FieldShell label="Agency name">
          <input value={brand} readOnly />
        </FieldShell>
        <FieldShell label="Agent name">
          <input value={brandKit.identity.tradingName ?? "Northstar Agent"} readOnly />
        </FieldShell>
        <div className="studio-brand-preview">
          <span style={{ background: brandKit.colours.primary || "#0f1729" }}>{brand.charAt(0)}</span>
          <div>
            <strong>{brand}</strong>
            <small>{brandKit.contact.phone ?? "(08) 9999 0000"}</small>
          </div>
        </div>
        <div className="studio-swatches">
          {[brandKit.colours.primary, brandKit.colours.secondary, brandKit.colours.accent].filter(Boolean).map((colour) => (
            <span key={colour} style={{ background: colour }} />
          ))}
        </div>
        <details className="studio-advanced">
          <summary>Advanced</summary>
          <p>Fonts, CTA style, compliance footer, website, phone, and email stay locked to the approved kit.</p>
        </details>
      </>
    );
  }

  if (section === "media") {
    return (
      <>
        <PanelHeader title="Media" detail="Use property and brand-safe imagery." />
        <button className="studio-dropzone" type="button" onClick={openFilePicker}>
          <ImageIcon aria-hidden size={22} />
          <span>Replace image</span>
          <small>PNG or JPG</small>
        </button>
        <div className="studio-media-grid">
          {MEDIA_ASSETS.map((asset) => (
            <button className={primaryImage === asset.src ? "active" : ""} key={asset.src} type="button">
              <img src={asset.src} alt="" />
              <span>{asset.label}</span>
              <small>{asset.type} / {asset.ratio}</small>
            </button>
          ))}
        </div>
      </>
    );
  }

  if (section === "copy") {
    return (
      <>
        <PanelHeader title="Copy" detail="Edit message, not layout." />
        <CopyFields copy={copy} updateCopy={updateCopy} />
        <div className="studio-assist-row">
          {["Make sharper", "Make more local", "Make more premium", "Make more direct", "Reduce hype", "Generate 5 hooks"].map((label) => (
            <button key={label} type="button">
              {label}
            </button>
          ))}
        </div>
      </>
    );
  }

  if (section === "audience") {
    return (
      <>
        <PanelHeader title="Audience" detail="Keep targeting guidance plain and safe." />
        <FieldShell label="Saved audience">
          <select defaultValue="seller">
            <option value="seller">South Perth homeowners</option>
            <option value="warm">Warm website visitors</option>
            <option value="open">Open-home visitors</option>
          </select>
        </FieldShell>
        <div className="studio-note-card">
          <UsersRound aria-hidden size={18} />
          Housing ads stay broad. Avoid sensitive personal attributes.
        </div>
      </>
    );
  }

  if (section === "landing") {
    return (
      <>
        <PanelHeader title="Landing" detail="Send leads to one clear destination." />
        <FieldShell label="Destination URL">
          <input value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} />
        </FieldShell>
        <FieldShell label="Lead destination">
          <select value={leadDestination} onChange={(event) => setLeadDestination(event.target.value)}>
            <option>Landing page</option>
            <option>Meta lead form</option>
            <option>CRM endpoint</option>
          </select>
        </FieldShell>
        <button className="studio-btn secondary block" type="button">
          <Globe2 aria-hidden size={17} />
          Test landing page
        </button>
      </>
    );
  }

  if (section === "publish") {
    return (
      <>
        <PanelHeader title="Publish" detail="Confirm the launch checklist before export." />
        <div className="studio-publish-list">
          {["Story", "Feed", "Square"].map((item) => (
            <label key={item}>
              <input type="checkbox" defaultChecked />
              {item}
            </label>
          ))}
        </div>
        <FieldShell label="Budget">
          <input defaultValue="Manual export" />
        </FieldShell>
        <FieldShell label="Schedule">
          <input defaultValue="Choose in ad account" />
        </FieldShell>
      </>
    );
  }

  if (section === "settings") {
    return (
      <>
        <PanelHeader title="Settings" detail="Workspace defaults and permissions." />
        <div className="studio-note-card">
          <Settings2 aria-hidden size={18} />
          Account, permissions, and defaults remain managed by workspace settings.
        </div>
        <details className="studio-advanced">
          <summary>Advanced</summary>
          <p>Duplicate, export, archive, share, and reset actions live in the More menu.</p>
        </details>
      </>
    );
  }

  return (
    <>
      <PanelHeader title="Campaign" detail="Set up the basics for your campaign." />
      <FieldShell label="Campaign goal" icon={Target}>
        <select value={campaignGoal} onChange={(event) => setCampaignGoal(event.target.value)}>
          <option>Get appraisal leads</option>
          <option>Promote recent sale</option>
          <option>Generate vendor leads</option>
          <option>Promote open home</option>
          <option>Drive market report downloads</option>
          <option>Retarget warm audience</option>
        </select>
      </FieldShell>
      <FieldShell label="Offer" icon={BadgeCheck}>
        <select value={offerLabel} onChange={(event) => setOfferLabel(event.target.value)}>
          <option>Free appraisal</option>
          <option>Market update</option>
          <option>Recent sales report</option>
          <option>Buyer demand check</option>
          <option>Home value estimate</option>
        </select>
      </FieldShell>
      <FieldShell label="Market / Location" icon={MapPin}>
        <input value={market} onChange={(event) => setMarket(event.target.value)} />
      </FieldShell>
      <FieldShell label="Property type" icon={Home}>
        <select value={propertyType} onChange={(event) => setPropertyType(event.target.value)}>
          <option>Houses</option>
          <option>Apartments</option>
          <option>Townhouses</option>
          <option>Land</option>
        </select>
      </FieldShell>
      <FieldShell label="Lead destination" icon={Globe2}>
        <select value={leadDestination} onChange={(event) => setLeadDestination(event.target.value)}>
          <option>Landing page</option>
          <option>Meta lead form</option>
          <option>CRM endpoint</option>
        </select>
      </FieldShell>
      <FieldShell label="Destination URL">
        <input value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} />
      </FieldShell>
      <button className="studio-link-btn" type="button">
        <Pencil aria-hidden size={16} />
        Edit campaign brief
      </button>
      <button
        className="studio-btn publish block"
        type="button"
        onClick={() => onGenerate(angles.find((angle) => angle.id === selectedAngleId) ?? angles[0])}
      >
        <Wand2 aria-hidden size={17} />
        Generate variants
      </button>
    </>
  );
}

function PanelHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="studio-panel-header">
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

function FieldShell({ label, icon: Icon, children }: { label: string; icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <label className="studio-field">
      <span>{label}</span>
      <div>
        {Icon ? <Icon aria-hidden size={17} /> : null}
        {children}
      </div>
    </label>
  );
}

function PreviewControls({
  previewFormat,
  setPreviewFormat,
  zoom,
  setZoom,
  device,
  setDevice,
}: {
  previewFormat: PreviewFormat;
  setPreviewFormat: (format: PreviewFormat) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  device: "mobile" | "desktop";
  setDevice: (device: "mobile" | "desktop") => void;
}) {
  const zoomMin = 50;
  const zoomMax = 150;
  const zoomStep = 25;
  return (
    <div className="studio-preview-controls">
      <div className="studio-format-group">
        <div className="studio-segment">
          {(["story", "feed", "square", "landscape"] as PreviewFormat[]).map((item) => (
            <button className={previewFormat === item ? "active" : ""} key={item} type="button" onClick={() => setPreviewFormat(item)}>
              {FORMAT_META[item].label}
            </button>
          ))}
        </div>
        <span className="studio-format-size">{FORMAT_META[previewFormat].size.replace("x", " × ")}</span>
      </div>
      <div className="studio-control-right">
        <div className="studio-zoom">
          <button type="button" aria-label="Zoom out" disabled={zoom <= zoomMin} onClick={() => setZoom(Math.max(zoomMin, zoom - zoomStep))}>
            <Minus aria-hidden size={16} />
          </button>
          <span>{zoom}%</span>
          <button type="button" aria-label="Zoom in" disabled={zoom >= zoomMax} onClick={() => setZoom(Math.min(zoomMax, zoom + zoomStep))}>
            <Plus aria-hidden size={16} />
          </button>
        </div>
        <span className="studio-control-sep" aria-hidden />
        <div className="studio-segment icons">
          <button className={device === "mobile" ? "active" : ""} type="button" aria-label="Mobile preview" onClick={() => setDevice("mobile")}>
            <Smartphone aria-hidden size={17} />
          </button>
          <button className={device === "desktop" ? "active" : ""} type="button" aria-label="Desktop preview" onClick={() => setDevice("desktop")}>
            <Monitor aria-hidden size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

function AdPreview({
  brand,
  domain,
  initials,
  copy,
  image,
  format,
  zoom,
  selectedElement,
  setSelectedElement,
}: {
  brand: string;
  domain: string;
  initials: string;
  copy: CopyState;
  image: string;
  format: PreviewFormat;
  zoom: number;
  selectedElement: SelectedElement;
  setSelectedElement: (element: SelectedElement) => void;
}) {
  const transform = { "--preview-scale": String(zoom / 100) } as CSSProperties;

  if (format === "story") {
    return (
      <div className="studio-preview-device" style={transform}>
        <div className="studio-story-card">
          <img src={image} alt="" />
          <span className="studio-story-shade" />
          <div className="studio-story-brand">
            <span>{initials}</span>
            <div>
              <strong>{brand}</strong>
              <small>Sponsored</small>
            </div>
          </div>
          <button className="studio-hit image" type="button" aria-label="Edit image" onClick={() => setSelectedElement("image")} />
          <button
            className={selectedElement === "headline" ? "studio-story-headline selected" : "studio-story-headline"}
            type="button"
            onClick={() => setSelectedElement("headline")}
          >
            {copy.headline}
          </button>
          <button
            className={selectedElement === "description" ? "studio-story-body selected" : "studio-story-body"}
            type="button"
            onClick={() => setSelectedElement("description")}
          >
            {copy.description}
          </button>
          <button className={selectedElement === "cta" ? "studio-story-cta selected" : "studio-story-cta"} type="button" onClick={() => setSelectedElement("cta")}>
            {copy.cta}
            <ChevronRight aria-hidden size={17} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-preview-device" style={transform}>
      <article className={format === "landscape" ? "studio-feed-card landscape" : "studio-feed-card"}>
        <header>
          <div className="studio-feed-id">
            <span>{initials}</span>
            <div>
              <strong>{brand}</strong>
              <small>Sponsored</small>
            </div>
          </div>
          <MoreHorizontal aria-hidden size={18} />
        </header>
        <button className={selectedElement === "primaryText" ? "studio-feed-primary selected" : "studio-feed-primary"} type="button" onClick={() => setSelectedElement("primaryText")}>
          {copy.primaryText}
        </button>
        <button className="studio-feed-image" type="button" onClick={() => setSelectedElement("image")}>
          <img src={image} alt="" />
        </button>
        <footer>
          <div>
            <small>{domain}</small>
            <button className={selectedElement === "headline" ? "studio-feed-headline selected" : "studio-feed-headline"} type="button" onClick={() => setSelectedElement("headline")}>
              {copy.headline}
            </button>
            <button className={selectedElement === "description" ? "studio-feed-desc selected" : "studio-feed-desc"} type="button" onClick={() => setSelectedElement("description")}>
              {copy.description}
            </button>
          </div>
          <button className={selectedElement === "cta" ? "studio-feed-cta selected" : "studio-feed-cta"} type="button" onClick={() => setSelectedElement("cta")}>
            {copy.cta}
          </button>
        </footer>
      </article>
    </div>
  );
}

function VariantStrip({
  variants,
  selectedVariantIndex,
  onSelect,
  compact = false,
}: {
  variants: Array<{ variantId: string; displayName: string; angleLabel: string; image: string; headline: string }>;
  selectedVariantIndex: number;
  onSelect: (index: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "studio-variant-strip compact" : "studio-variant-strip"}>
      <div className="studio-variant-strip-head">
        <strong>Variants</strong>
        <button type="button">View all</button>
      </div>
      <div className="studio-variant-row">
        {variants.map((variant, index) => (
          <button className={selectedVariantIndex === index ? "studio-variant-tile active" : "studio-variant-tile"} key={variant.variantId} type="button" onClick={() => onSelect(index)}>
            <span className="studio-variant-image">
              <img src={variant.image} alt="" />
              {selectedVariantIndex === index ? <Check aria-hidden size={15} /> : null}
            </span>
            <strong>{variant.displayName}</strong>
            <small>{variant.angleLabel}</small>
          </button>
        ))}
        {!compact && (
          <button className="studio-add-variant" type="button">
            <Plus aria-hidden size={20} />
            Add variant
          </button>
        )}
      </div>
    </div>
  );
}

function Inspector({
  tab,
  setTab,
  readinessScore,
  readinessItems,
  selectedElement,
  copy,
  updateCopy,
  openFilePicker,
  applyCopyAssist,
  destinationUrl,
  publishBlocker,
  onExport,
}: {
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
  readinessScore: number;
  readinessItems: ReadinessItem[];
  selectedElement: SelectedElement;
  copy: CopyState;
  updateCopy: (key: keyof CopyState, value: string) => void;
  openFilePicker: () => void;
  applyCopyAssist: (action: string) => void;
  destinationUrl: string;
  publishBlocker: string;
  onExport: () => void;
}) {
  return (
    <>
      <div className="studio-inspector-tabs">
        {(["edit", "publish"] as InspectorTab[]).map((item) => (
          <button className={tab === item ? "active" : ""} key={item} type="button" onClick={() => setTab(item)}>
            {item.charAt(0).toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {tab === "edit" && (
        <div className="studio-edit-panel">
          <PanelHeader title={selectedElement === "image" ? "Edit image" : "Edit copy"} detail={selectedElement === "image" ? "Replace and crop inside safe areas." : "Keep copy clear and local."} />
          {selectedElement === "image" ? (
            <>
              <button className="studio-btn secondary block" type="button" onClick={openFilePicker}>
                <ImageIcon aria-hidden size={17} />
                Replace image
              </button>
              {["Crop", "Fit", "Dark overlay", "Brightness", "Safe area"].map((label) => (
                <label className="studio-toggle-row" key={label}>
                  <span>{label}</span>
                  <input type="checkbox" defaultChecked={label === "Dark overlay" || label === "Safe area"} />
                </label>
              ))}
            </>
          ) : (
            <>
              <CopyFields copy={copy} updateCopy={updateCopy} />
              <div className="studio-assist-row">
                {["Make sharper", "Make more local", "Make more premium", "Make more direct", "Reduce hype", "Generate 5 hooks"].map((label) => (
                  <button key={label} type="button" onClick={() => applyCopyAssist(label)}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {tab === "publish" && (
        <div className="studio-inspector-publish">
          <ReadinessCard score={readinessScore} items={readinessItems} compact={false} />
          <PublishPanel destinationUrl={destinationUrl} blocker={publishBlocker} onExport={onExport} />
        </div>
      )}
    </>
  );
}

function CopyFields({ copy, updateCopy }: { copy: CopyState; updateCopy: (key: keyof CopyState, value: string) => void }) {
  return (
    <div className="studio-copy-fields">
      {([
        ["primaryText", "Primary text"],
        ["headline", "Headline"],
        ["description", "Description"],
        ["cta", "CTA"],
      ] as Array<[keyof CopyState, string]>).map(([key, label]) => (
        <label key={key}>
          <span>
            {label}
            <small>{copy[key].length} / {COPY_LIMITS[key]}</small>
          </span>
          <textarea rows={key === "primaryText" ? 3 : 2} value={copy[key]} onChange={(event) => updateCopy(key, event.target.value)} />
        </label>
      ))}
    </div>
  );
}

function ReadinessCard({ score, items, compact }: { score: number; items: ReadinessItem[]; compact: boolean }) {
  return (
    <section className={compact ? "studio-readiness compact" : "studio-readiness"}>
      <header>
        <h3>Campaign readiness</h3>
        {!compact && <ChevronRight aria-hidden size={20} />}
      </header>
      <div className="studio-readiness-main">
        <div className="studio-score" style={{ "--score": `${score}%` } as CSSProperties}>
          <span>{score}%</span>
        </div>
        {!compact && <p>Great. You are almost ready to publish.</p>}
      </div>
      <div className="studio-checklist">
        {items.map((item) => (
          <div className={item.state} key={item.label}>
            <span className="studio-check-icon">
              {item.state === "done" ? <Check aria-hidden size={13} /> : item.state === "warn" ? <CircleAlert aria-hidden size={13} /> : <Circle aria-hidden size={13} />}
            </span>
            <div>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </div>
          </div>
        ))}
      </div>
      {!compact && (
        <button className="studio-recommendations" type="button">
          View all recommendations
          <ChevronRight aria-hidden size={16} />
        </button>
      )}
    </section>
  );
}

function PublishPanel({ destinationUrl, blocker, onExport }: { destinationUrl: string; blocker: string; onExport: () => void }) {
  return (
    <div className="studio-publish-panel">
      <PanelHeader title="Publish" detail="Manual export first. Live publishing remains gated." />
      {blocker ? <div className="studio-publish-blocker">{blocker}</div> : <div className="studio-publish-ready">Ready to publish manually.</div>}
      {[
        ["Formats included", "Story, Feed, Square"],
        ["Destination", destinationUrl || "Missing"],
        ["Budget", "Set in ad account"],
        ["Schedule", "Set in ad account"],
        ["Tracking", "Needs confirmation"],
        ["Approval status", "Draft review"],
      ].map(([label, value]) => (
        <div className="studio-publish-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
      <button className="studio-btn publish block" type="button" onClick={onExport} disabled={Boolean(blocker)}>
        <Download aria-hidden size={17} />
        Export creatives
      </button>
    </div>
  );
}

const STYLES = `
.studio-screen{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;background:#f7f8fa;color:var(--ink);font-size:14px;letter-spacing:0}
.studio-screen *{box-sizing:border-box}
.studio-screen button,.studio-screen input,.studio-screen select,.studio-screen textarea{font:inherit}
.studio-screen button{cursor:pointer}
.studio-topbar{position:relative;z-index:4;height:72px;display:flex;align-items:center;justify-content:space-between;gap:18px;border-bottom:1px solid var(--line);background:#fff;padding:0 28px}
.studio-titlebar,.studio-mobile-title,.studio-actions{display:flex;align-items:center;gap:14px;min-width:0}
.studio-titlebar .blockwise-symbol{width:30px;height:30px}
.studio-titlebar .blockwise-wordmark{font-size:22px}
.studio-mobile-title{display:none}
.studio-divider{width:1px;height:28px;background:var(--line)}
.studio-breadcrumb{font-size:16px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-btn,.studio-icon-btn{height:44px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:0 17px;font-weight:700;white-space:nowrap}
.studio-btn.secondary:hover,.studio-icon-btn:hover{background:var(--surface-subtle)}
.studio-btn.publish{background:#111;color:#fff;border-color:#111}
.studio-btn.publish:hover{background:#000}
.studio-btn.block{width:100%}
.studio-btn:disabled{opacity:.55;cursor:not-allowed}
.studio-icon-btn{width:44px;padding:0}
.studio-more-menu{position:absolute;right:18px;top:60px;width:260px;display:grid;gap:4px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:14px;box-shadow:0 18px 50px rgba(15,23,41,.14);z-index:10}
.studio-more-menu button{min-height:40px;border:0;background:transparent;border-radius:8px;color:var(--ink);display:grid;grid-template-columns:22px 1fr 18px;align-items:center;gap:10px;padding:0 8px;text-align:left}
.studio-more-menu button:hover{background:var(--surface-subtle)}
.studio-more-menu .danger{color:#dc2626}
.studio-menu-line{height:1px;background:var(--line);margin:5px 0}
.studio-desktop-body{flex:1;min-height:0;display:grid;grid-template-columns:210px 310px minmax(430px,1fr) 350px;background:#fff}
.studio-rail{border-right:1px solid var(--line);background:#fff;padding:22px 16px;display:grid;align-content:start;gap:8px}
.studio-rail button{height:54px;border:0;border-radius:8px;background:transparent;color:var(--ink);display:flex;align-items:center;gap:14px;padding:0 18px;font-weight:750;text-align:left}
.studio-rail button:hover,.studio-rail button.active{background:#f3f4f6}
.studio-left-panel{min-width:0;min-height:0;overflow:auto;border-right:1px solid var(--line);padding:30px 28px;display:flex;flex-direction:column;gap:22px}
.studio-panel-header h2{margin:0 0 8px;font-size:22px;line-height:1.1;font-weight:750;letter-spacing:0}
.studio-panel-header p{margin:0;color:var(--muted);font-size:14px}
.studio-field{display:grid;gap:8px}
.studio-field>span{font-size:13px;font-weight:750;color:var(--ink)}
.studio-field>div{min-height:46px;border:1px solid var(--line);border-radius:8px;background:#fff;display:flex;align-items:center;gap:10px;padding:0 12px}
.studio-field svg{color:var(--ink);flex:0 0 auto}
.studio-field input,.studio-field select{width:100%;min-width:0;border:0;background:transparent;color:var(--ink);outline:none}
.studio-link-btn{width:max-content;border:0;background:transparent;color:var(--ink);display:inline-flex;align-items:center;gap:9px;font-weight:750;padding:0}
.studio-angle-list{display:grid;gap:10px}
.studio-angle-card{display:grid;grid-template-columns:62px 1fr;gap:12px;align-items:center;border:1px solid var(--line);border-radius:8px;background:#fff;padding:10px;text-align:left}
.studio-angle-card.active,.studio-angle-card:hover{border-color:#111;box-shadow:0 0 0 1px #111}
.studio-angle-thumb{width:62px;height:50px;border-radius:7px;background-size:cover;background-position:center}
.studio-angle-card strong,.studio-angle-card small,.studio-angle-card em{display:block}
.studio-angle-card strong{font-size:14px}
.studio-angle-card small{color:var(--muted);line-height:1.35;margin-top:2px}
.studio-angle-card em{font-style:normal;color:var(--muted);font-size:12px;margin-top:5px}
.studio-brand-preview,.studio-note-card{border:1px solid var(--line);border-radius:8px;background:#fff;padding:14px;display:flex;gap:12px;align-items:center}
.studio-brand-preview span{width:46px;height:46px;border-radius:999px;color:#fff;display:grid;place-items:center;font-weight:850}
.studio-brand-preview small,.studio-note-card{color:var(--muted)}
.studio-swatches{display:flex;gap:9px}
.studio-swatches span{width:36px;height:36px;border:1px solid var(--line);border-radius:8px}
.studio-advanced{border:1px solid var(--line);border-radius:8px;background:#fff;padding:12px}
.studio-advanced summary{cursor:pointer;font-weight:750}
.studio-advanced p{color:var(--muted);margin:10px 0 0}
.studio-dropzone{min-height:112px;border:1.5px dashed var(--line);border-radius:8px;background:#fff;display:grid;place-items:center;gap:4px;color:var(--muted)}
.studio-dropzone span{font-weight:750;color:var(--ink)}
.studio-media-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.studio-media-grid button{border:1px solid var(--line);border-radius:8px;background:#fff;padding:8px;text-align:left}
.studio-media-grid button.active{border-color:#111}
.studio-media-grid img{display:block;width:100%;aspect-ratio:1.25/1;object-fit:cover;border-radius:6px;margin-bottom:8px}
.studio-media-grid span,.studio-media-grid small{display:block}
.studio-media-grid small{color:var(--muted);font-size:11px}
.studio-copy-fields{display:grid;gap:12px}
.studio-copy-fields label{display:grid;gap:7px}
.studio-copy-fields span{display:flex;justify-content:space-between;gap:12px;font-weight:750}
.studio-copy-fields small{color:var(--muted);font-weight:650}
.studio-copy-fields textarea{width:100%;resize:vertical;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:10px 11px;outline:none}
.studio-copy-fields textarea:focus{border-color:#111;box-shadow:0 0 0 2px rgba(17,17,17,.08)}
.studio-assist-row{display:flex;flex-wrap:wrap;gap:8px}
.studio-assist-row button,.studio-card-actions button{border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);min-height:32px;padding:0 10px;font-size:12px;font-weight:750}
.studio-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:11px 0;font-weight:700}
.studio-preview-column{min-width:0;min-height:0;display:flex;flex-direction:column;background:#fafafa}
.studio-preview-controls{min-height:64px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 22px;background:#fff;flex-wrap:wrap}
.studio-format-group{display:inline-flex;align-items:center;gap:12px;min-width:0}
.studio-format-size{font-size:12px;color:var(--muted);white-space:nowrap}
.studio-segment{display:inline-flex;align-items:center;gap:3px;border:1px solid var(--line);border-radius:8px;background:#f6f6f6;padding:3px}
.studio-segment button{border:0;border-radius:6px;background:transparent;color:var(--ink);height:32px;padding:0 14px;font-weight:750;font-size:13px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.studio-segment button.active{background:#111;color:#fff}
.studio-segment.icons button{width:34px;padding:0;justify-content:center}
.studio-control-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.studio-control-sep{width:1px;height:22px;background:var(--line)}
.studio-zoom{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:8px;background:#f6f6f6;padding:3px}
.studio-zoom button{width:32px;height:32px;border:0;border-radius:6px;background:transparent;color:var(--ink);display:inline-flex;align-items:center;justify-content:center}
.studio-zoom button:hover:not(:disabled){background:#ececec}
.studio-zoom button:disabled{opacity:.4;cursor:not-allowed}
.studio-zoom span{min-width:48px;text-align:center;font-weight:750;font-size:13px}
.studio-stage{position:relative;flex:1;min-height:0;display:grid;place-items:center;overflow:auto;padding:34px}
.studio-preview-device{transform:scale(var(--preview-scale));transform-origin:center;transition:transform .16s ease}
.studio-story-card{position:relative;width:332px;aspect-ratio:9/16;overflow:hidden;border-radius:22px;background:#111;color:#fff;box-shadow:0 26px 70px rgba(15,23,41,.2)}
.studio-story-card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.studio-story-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.38) 0%,rgba(0,0,0,.08) 38%,rgba(0,0,0,.66) 100%)}
.studio-story-brand{position:absolute;top:18px;left:18px;right:18px;z-index:3;display:flex;align-items:center;gap:10px}
.studio-story-brand span{width:42px;height:42px;border-radius:999px;background:#172033;color:#fff;display:grid;place-items:center;font-size:21px;font-weight:800}
.studio-story-brand strong,.studio-story-brand small{display:block;text-shadow:0 1px 5px rgba(0,0,0,.4)}
.studio-story-brand small{font-size:12px;opacity:.9}
.studio-hit.image{position:absolute;inset:0;z-index:2;border:0;background:transparent}
.studio-story-headline,.studio-story-body,.studio-story-cta{position:absolute;z-index:4;border:0;background:transparent;color:#fff;text-align:left;padding:0}
.studio-story-headline{left:24px;right:24px;bottom:158px;font-family:Georgia,serif;font-size:35px;line-height:1.03;font-weight:750;text-shadow:0 2px 12px rgba(0,0,0,.55)}
.studio-story-body{left:24px;right:58px;bottom:104px;font-size:22px;line-height:1.18;text-shadow:0 2px 9px rgba(0,0,0,.55)}
.studio-story-cta{left:24px;right:24px;bottom:24px;min-height:54px;border-radius:8px;background:#fff;color:#111;display:flex;align-items:center;justify-content:space-between;padding:0 20px;font-size:16px;font-weight:800;box-shadow:0 8px 22px rgba(0,0,0,.26)}
.selected{outline:2px solid #fff;outline-offset:3px}
.studio-feed-card{width:392px;overflow:hidden;border:1px solid #e6e8ed;border-radius:24px;background:#fff;box-shadow:0 18px 55px rgba(15,23,41,.12)}
.studio-feed-card.landscape{width:560px}
.studio-feed-card header{height:70px;display:flex;align-items:center;justify-content:space-between;padding:0 18px}
.studio-feed-id{display:flex;align-items:center;gap:11px}
.studio-feed-id span{width:42px;height:42px;border-radius:999px;background:#172033;color:#fff;display:grid;place-items:center;font-weight:850}
.studio-feed-id strong,.studio-feed-id small{display:block}
.studio-feed-id small{color:var(--muted);font-size:12px}
.studio-feed-primary,.studio-feed-headline,.studio-feed-desc{display:block;width:100%;border:0;background:transparent;color:var(--ink);text-align:left}
.studio-feed-primary{padding:0 18px 16px;line-height:1.38}
.studio-feed-image{display:block;width:100%;border:0;background:#eee;padding:0}
.studio-feed-image img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover}
.studio-feed-card.landscape .studio-feed-image img{aspect-ratio:1.91/1}
.studio-feed-card footer{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;background:#f3f4f6;padding:15px 18px}
.studio-feed-card footer small{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;font-weight:750}
.studio-feed-headline{font-size:17px;font-weight:800;line-height:1.18;margin-top:4px}
.studio-feed-desc{color:var(--muted);font-size:13px;line-height:1.3;margin-top:3px}
.studio-feed-cta{border:0;border-radius:8px;background:#172033;color:#fff;min-height:38px;padding:0 14px;font-weight:800}
.studio-busy{position:absolute;inset:0;z-index:5;background:rgba(250,250,250,.78);display:grid;place-items:center}
.studio-busy-card{width:280px;border:1px solid var(--line);border-radius:8px;background:#fff;display:grid;gap:9px;justify-items:center;padding:22px;text-align:center;box-shadow:0 18px 50px rgba(15,23,41,.12)}
.studio-busy-card svg{animation:studio-spin 1s linear infinite}
@keyframes studio-spin{to{transform:rotate(360deg)}}
.studio-busy-card span{color:var(--muted);font-size:12px}
.studio-variant-strip{border-top:1px solid var(--line);background:#fff;padding:18px 24px}
.studio-variant-strip-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.studio-variant-strip-head button{border:0;background:transparent;font-weight:700}
.studio-variant-row{display:flex;gap:16px;overflow-x:auto;padding-bottom:2px}
.studio-variant-tile,.studio-add-variant{width:146px;flex:0 0 auto;border:1px solid var(--line);border-radius:8px;background:#fff;padding:8px;text-align:center}
.studio-variant-tile.active{border-color:#111;box-shadow:0 0 0 2px #111}
.studio-variant-image{position:relative;display:block}
.studio-variant-image img{display:block;width:100%;height:106px;object-fit:cover;border-radius:7px}
.studio-variant-image svg{position:absolute;top:8px;left:8px;width:28px;height:28px;border-radius:999px;background:#111;color:#fff;padding:6px}
.studio-variant-tile strong,.studio-variant-tile small{display:block}
.studio-variant-tile strong{margin-top:8px}
.studio-variant-tile small{color:var(--muted)}
.studio-add-variant{display:grid;place-items:center;align-content:center;gap:8px;border-style:dashed;color:var(--ink);min-height:164px}
.studio-inspector{min-height:0;border-left:1px solid var(--line);background:#fff;padding:22px 22px 26px;overflow:auto}
.studio-inspector-publish{display:grid;gap:18px}
.studio-inspector-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;border:1px solid var(--line);border-radius:8px;background:#f6f6f6;padding:4px;margin-bottom:22px}
.studio-inspector-tabs button{border:0;border-radius:7px;background:transparent;color:var(--ink);min-height:36px;font-weight:750}
.studio-inspector-tabs button.active{background:#fff;box-shadow:0 1px 2px rgba(15,23,41,.05)}
.studio-readiness{border:1px solid var(--line);border-radius:8px;background:#fff;padding:22px}
.studio-readiness header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px}
.studio-readiness h3{font-size:18px;margin:0}
.studio-readiness-main{display:flex;align-items:center;gap:20px;margin-bottom:22px}
.studio-readiness-main p{margin:0;line-height:1.45}
.studio-score{width:86px;height:86px;border-radius:999px;display:grid;place-items:center;background:conic-gradient(#45b757 var(--score),#e8ecef 0)}
.studio-score span{width:62px;height:62px;border-radius:999px;background:#fff;display:grid;place-items:center;font-size:18px;font-weight:850}
.studio-checklist{display:grid;gap:14px}
.studio-checklist>div{display:grid;grid-template-columns:22px 1fr;gap:10px;align-items:start}
.studio-check-icon{width:19px;height:19px;border-radius:999px;display:grid;place-items:center;margin-top:1px}
.studio-checklist .done .studio-check-icon{background:#45b757;color:#fff}
.studio-checklist .warn .studio-check-icon{background:#ffb020;color:#fff}
.studio-checklist .todo .studio-check-icon{border:1px solid #aab3c1;color:#6b7280}
.studio-checklist strong,.studio-checklist small{display:block}
.studio-checklist small{color:var(--muted);line-height:1.35}
.studio-recommendations{width:100%;min-height:44px;border:1px solid var(--line);border-radius:8px;background:#fff;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 14px;margin-top:22px;font-weight:750}
.studio-edit-panel,.studio-publish-panel{display:grid;gap:14px}
.studio-publish-blocker,.studio-publish-ready{border-radius:8px;padding:12px;font-weight:750}
.studio-publish-blocker{background:#fff2f2;color:#b91c1c;border:1px solid #ffd5d5}
.studio-publish-ready{background:#edf8f0;color:#126b35;border:1px solid #cdebd4}
.studio-publish-row{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:10px 0}
.studio-publish-row span{color:var(--muted)}
.studio-publish-list{display:grid;gap:10px}
.studio-publish-list label{display:flex;align-items:center;gap:10px;font-weight:750}
.studio-statusbar{height:38px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid var(--line);background:#fff;color:var(--muted);padding:0 24px;font-size:12px;font-weight:700}
.studio-statusbar .error{color:#b91c1c}
.studio-toast{position:fixed;left:50%;bottom:54px;z-index:200;transform:translateX(-50%);border-radius:8px;background:#111;color:#fff;padding:11px 16px;font-weight:750;box-shadow:0 18px 45px rgba(15,23,41,.2)}
.studio-mobile-body,.studio-mobile-bottom{display:none}
@media(max-width:1180px){
  .studio-desktop-body{grid-template-columns:178px 286px minmax(360px,1fr)}
  .studio-inspector{display:none}
}
@media(max-width:900px){
  .studio-screen{background:#fff;padding-bottom:88px;overflow:hidden}
  .studio-topbar{height:78px;padding:0 18px}
  .studio-titlebar,.studio-actions .secondary,.studio-actions .publish{display:none}
  .studio-mobile-title{display:flex}
  .studio-mobile-title .blockwise-symbol{width:25px;height:25px}
  .studio-mobile-title .blockwise-wordmark{font-size:19px}
  .studio-desktop-body,.studio-statusbar{display:none}
  .studio-mobile-body{display:block;flex:1;min-height:0;overflow:auto;padding:0 20px 24px}
  .studio-mobile-campaign{border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin:0 -20px;padding:14px 20px}
  .studio-mobile-campaign-btn{height:48px;border:1px solid var(--line);border-radius:8px;background:#fff;display:flex;align-items:center;gap:12px;padding:0 12px;font-weight:750}
  .studio-mobile-format-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:0;background:#f2f2f2;border-radius:10px;padding:4px;margin:28px 0 24px}
  .studio-mobile-format-tabs button{height:44px;border:0;border-radius:8px;background:transparent;font-weight:750}
  .studio-mobile-format-tabs button.active{background:#111;color:#fff}
  .studio-mobile-preview-wrap{display:grid;place-items:center}
  .studio-mobile-preview-wrap .studio-preview-device{transform:none}
  .studio-mobile-preview-wrap .studio-story-card{width:min(340px,88vw)}
  .studio-mobile-preview-wrap .studio-feed-card{width:min(340px,88vw);border-radius:18px}
  .studio-mobile-preview-wrap .studio-feed-card.landscape{width:min(340px,88vw)}
  .studio-mobile-variants{margin-top:24px}
  .studio-mobile-variants .studio-variant-strip{border:0;padding:0;background:transparent}
  .studio-variant-strip.compact .studio-variant-tile{width:132px}
  .studio-variant-strip.compact .studio-variant-image img{height:96px}
  .studio-readiness.compact{margin:28px 0 0;padding:18px}
  .studio-readiness.compact .studio-readiness-main{margin-bottom:0}
  .studio-readiness.compact .studio-checklist{display:none}
  .studio-mobile-panel{display:grid;gap:18px;padding-top:22px}
  .studio-mobile-bottom{position:fixed;left:0;right:0;bottom:0;z-index:150;height:78px;border-top:1px solid var(--line);background:#fff;display:grid;grid-template-columns:repeat(4,1fr);padding:8px 12px 10px}
  .studio-mobile-bottom button{border:0;border-radius:8px;background:transparent;color:#111;display:grid;place-items:center;gap:2px;font-size:12px}
  .studio-mobile-bottom button.active{background:#f0f0f0}
  .studio-more-menu{right:12px;top:66px;width:min(286px,calc(100vw - 24px))}
}
@media(max-width:380px){
  .studio-story-headline{font-size:31px}
  .studio-story-body{font-size:19px}
  .studio-mobile-body{padding-left:14px;padding-right:14px}
}
`;
