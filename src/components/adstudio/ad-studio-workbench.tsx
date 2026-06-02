"use client";

import {
  BadgeCheck,
  ChevronDown,
  Copy,
  Image as ImageIcon,
  Link2,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Target,
  Type,
  UsersRound,
  Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioOfferTemplate,
} from "@/lib/adstudio";

import { ANGLES } from "./angles";
import { Inspector, PublishPanel, ReadinessCard } from "./inspector";
import { AdPreview, FORMAT_META, PreviewControls, VariantStrip } from "./preview";
import type { PreviewFormat, PreviewMode, SelectedElement } from "./preview";
import { STYLES } from "./styles";
import { TopBar } from "./topbar";
import { useAdStudio } from "./use-ad-studio";
import { useBrandKit } from "./use-brand-kit";
import { useCampaignActions } from "./use-campaign-actions";
import { seedCopy, useCopy } from "./use-copy";
import { MEDIA_ASSETS, useMedia } from "./use-media";
import { useReadiness } from "./use-readiness";

import { AnglesPanel } from "./panels/angles-panel";
import { AudiencePanel } from "./panels/audience-panel";
import { BrandPanel } from "./panels/brand-panel";
import { CampaignPanel } from "./panels/campaign-panel";
import { CopyPanel } from "./panels/copy-panel";
import { LandingPanel } from "./panels/landing-panel";
import { MediaPanel } from "./panels/media-panel";
import { PublishSetupPanel } from "./panels/publish-panel";
import { SettingsPanel } from "./panels/settings-panel";

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

const NAV_ITEMS: Array<{ id: import("./use-ad-studio").StudioSection; label: string; icon: LucideIcon }> = [
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

export function AdStudioWorkbench({
  brandKit,
  campaignPack: initialPack,
  offers,
}: AdStudioWorkbenchProps) {
  const [pack, setPack] = useState(initialPack);
  const [selectedAngleId, setSelectedAngleId] = useState("free_appraisal");
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>("story");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("platform");
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [zoom, setZoom] = useState(75);
  const [selectedElement, setSelectedElement] = useState<SelectedElement>("headline");
  const [campaignGoal, setCampaignGoal] = useState("Get appraisal leads");
  const [offerLabel, setOfferLabel] = useState("Free appraisal");
  const [market, setMarket] = useState("South Perth, WA");
  const [propertyType, setPropertyType] = useState("Houses");
  const [leadDestination, setLeadDestination] = useState("Landing page");
  const [destinationUrl, setDestinationUrl] = useState("northstarrealty.com.au/free-appraisal");

  const studio = useAdStudio();
  const { brand, initials, domain } = useBrandKit(brandKit);
  const { copy, setCopy, updateCopy, applyCopyAssist } = useCopy(
    initialPack,
    studio.setSaveState,
    studio.showToast,
    setSelectedElement,
  );
  const { primaryImage, setPrimaryImage, fileInputRef, replaceImage, openFilePicker } = useMedia(
    studio.showToast,
    () => {
      setSelectedElement("image");
      studio.setInspectorTab("edit");
    },
  );
  const { readinessItems, readinessScore } = useReadiness({
    campaignGoal,
    offerLabel,
    market,
    propertyType,
    destinationUrl,
    primaryImage,
    copy,
    pack,
  });

  // API routes used in campaign actions:
  //   POST /api/adstudio/campaigns — generate variants
  //   PATCH /api/adstudio/campaigns/${currentPack.campaign.campaignId}/draft — save draft
  //   POST /api/adstudio/export-packages/${currentPack.campaign.campaignId}/download — Export creatives
  //   platforms: ["meta"]
  const { generateVariantsForAngle, saveDraft, exportCreatives } = useCampaignActions({
    pack,
    brandKit,
    offers,
    market,
    copy,
    offerLabel,
    selectedVariantIndex,
    setPack,
    setSelectedVariantIndex,
    setCopy,
    setPrimaryImage,
    setOfferLabel,
    setSaveState: studio.setSaveState,
    setSaveError: studio.setSaveError,
    setBusy: studio.setBusy,
    setBusyMessage: studio.setBusyMessage,
    setSection: studio.setSection,
    setInspectorTab: studio.setInspectorTab,
    setSelectedAngleId,
    showToast: studio.showToast,
  });

  const selectedAngle = ANGLES.find((angle) => angle.id === selectedAngleId) ?? ANGLES[0];
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

  function selectVariant(index: number) {
    setSelectedVariantIndex(index);
    setCopy(seedCopy(pack, index));
    setPrimaryImage(MEDIA_ASSETS[index % MEDIA_ASSETS.length].src);
    studio.setInspectorTab("variants");
  }

  const publishBlocker = destinationUrl ? "" : "Publish blocked: Landing URL is missing.";

  function renderPanel() {
    if (studio.section === "angles") {
      return <AnglesPanel angles={ANGLES} selectedAngleId={selectedAngleId} onGenerate={generateVariantsForAngle} />;
    }
    if (studio.section === "brand") {
      return <BrandPanel brand={brand} brandKit={brandKit} />;
    }
    if (studio.section === "media") {
      return <MediaPanel primaryImage={primaryImage} openFilePicker={openFilePicker} />;
    }
    if (studio.section === "copy") {
      return <CopyPanel copy={copy} updateCopy={updateCopy} />;
    }
    if (studio.section === "audience") {
      return <AudiencePanel />;
    }
    if (studio.section === "landing") {
      return (
        <LandingPanel
          destinationUrl={destinationUrl}
          setDestinationUrl={setDestinationUrl}
          leadDestination={leadDestination}
          setLeadDestination={setLeadDestination}
        />
      );
    }
    if (studio.section === "publish") {
      return <PublishSetupPanel />;
    }
    if (studio.section === "settings") {
      return <SettingsPanel />;
    }
    return (
      <CampaignPanel
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
        onGenerate={generateVariantsForAngle}
      />
    );
  }

  return (
    <main className="studio-screen" aria-label="Ad Studio workspace">
      <style>{STYLES}</style>
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(event) => replaceImage(event.target.files)} />

      <TopBar
        campaignName={campaignName}
        showMore={studio.showMore}
        setShowMore={studio.setShowMore}
        onPreview={() => setPreviewMode("platform")}
        onSave={saveDraft}
        onPublish={() => studio.setInspectorTab("publish")}
        onExport={exportCreatives}
      />

      <div className="studio-desktop-body">
        <aside className="studio-rail" aria-label="Ad Studio sections">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={studio.section === item.id ? "active" : ""}
                key={item.id}
                type="button"
                onClick={() => {
                  studio.setSection(item.id);
                  if (item.id === "publish") studio.setInspectorTab("publish");
                }}
              >
                <Icon aria-hidden size={19} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </aside>

        <section className="studio-left-panel" aria-label={`${studio.section} setup`}>
          {renderPanel()}
        </section>

        <section className="studio-preview-column" aria-label="Ad preview">
          <PreviewControls
            previewFormat={previewFormat}
            setPreviewFormat={setPreviewFormat}
            previewMode={previewMode}
            setPreviewMode={setPreviewMode}
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
              mode={previewMode}
              zoom={zoom}
              selectedElement={selectedElement}
              setSelectedElement={(element) => {
                setSelectedElement(element);
                studio.setInspectorTab("edit");
              }}
            />
            {studio.busy && (
              <div className="studio-busy">
                <div className="studio-busy-card">
                  <RefreshCw aria-hidden size={22} />
                  <strong>{studio.busyMessage}</strong>
                  <span>No changes were made until generation completes.</span>
                </div>
              </div>
            )}
          </div>

          <VariantStrip variants={variants} selectedVariantIndex={selectedVariantIndex} onSelect={selectVariant} />
        </section>

        <aside className="studio-inspector" aria-label="Campaign inspector">
          <Inspector
            tab={studio.inspectorTab}
            setTab={studio.setInspectorTab}
            readinessScore={readinessScore}
            readinessItems={readinessItems}
            variants={variants}
            selectedVariantIndex={selectedVariantIndex}
            onSelectVariant={selectVariant}
            selectedElement={selectedElement}
            copy={copy}
            updateCopy={updateCopy}
            openFilePicker={openFilePicker}
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

        {studio.mobileTab === "campaign" && (
          <div className="studio-mobile-preview-wrap">
            <AdPreview
              brand={brand}
              domain={domain}
              initials={initials}
              copy={copy}
              image={primaryImage}
              format={previewFormat}
              mode="platform"
              zoom={100}
              selectedElement={selectedElement}
              setSelectedElement={(element) => {
                setSelectedElement(element);
                studio.setMobileTab("checklist");
              }}
            />
          </div>
        )}

        {studio.mobileTab === "variants" && (
          <div className="studio-mobile-panel">
            <VariantStrip variants={variants} selectedVariantIndex={selectedVariantIndex} onSelect={selectVariant} />
            <button className="studio-btn publish block" type="button" onClick={() => generateVariantsForAngle(selectedAngle)}>
              <Wand2 aria-hidden size={17} />
              Generate variants
            </button>
          </div>
        )}

        {studio.mobileTab === "checklist" && (
          <div className="studio-mobile-panel">
            <ReadinessCard score={readinessScore} items={readinessItems} compact={false} />
          </div>
        )}

        {studio.mobileTab === "publish" && (
          <div className="studio-mobile-panel">
            <PublishPanel destinationUrl={destinationUrl} blocker={publishBlocker} onExport={exportCreatives} />
          </div>
        )}

        <div className="studio-mobile-variants">
          <VariantStrip variants={variants} selectedVariantIndex={selectedVariantIndex} onSelect={selectVariant} compact />
        </div>

        {/* Campaign readiness — compact summary on mobile */}
        <ReadinessCard score={readinessScore} items={readinessItems.slice(0, 4)} compact />
      </div>

      <footer className="studio-statusbar">
        <span className={studio.saveState === "error" ? "error" : ""}>{studio.statusText}</span>
        <span>{format.label} | {format.size}</span>
        <span>{previewMode === "platform" ? "Platform preview" : "Creative preview"}</span>
      </footer>

      <nav className="studio-mobile-bottom" aria-label="Ad Studio mobile navigation">
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <button className={studio.mobileTab === item.id ? "active" : ""} key={item.id} type="button" onClick={() => studio.setMobileTab(item.id)}>
              <Icon aria-hidden size={22} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {studio.toast && <div className="studio-toast">{studio.toast}</div>}
    </main>
  );
}
