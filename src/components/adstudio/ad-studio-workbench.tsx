"use client";

import {
  Check,
  ChevronDown,
  CircleAlert,
  Image as ImageIcon,
  LayoutGrid,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Target,
  Type,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioOfferTemplate,
} from "@/lib/adstudio";
import { AD_STUDIO_TEMPLATES } from "@/lib/adstudio";

import { ANGLES } from "./angles";
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

import { AudiencePanel } from "./panels/audience-panel";
import { BrandPanel } from "./panels/brand-panel";
import { CampaignPanel } from "./panels/campaign-panel";
import { CopyPanel } from "./panels/copy-panel";
import { MediaPanel } from "./panels/media-panel";
import { PublishSetupPanel } from "./panels/publish-panel";
import { SettingsPanel } from "./panels/settings-panel";
import { TemplatesPanel } from "./panels/templates-panel";
import { NewAdDialog } from "./new-ad-dialog";

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

type NavItem = { id: import("./use-ad-studio").StudioSection; label: string; icon: LucideIcon };

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Create",
    items: [
      { id: "campaign", label: "Ad", icon: Target },
      { id: "templates", label: "Templates", icon: LayoutGrid },
      { id: "brand", label: "Brand", icon: ShieldCheck },
      { id: "media", label: "Media", icon: ImageIcon },
      { id: "copy", label: "Copy", icon: Type },
      { id: "audience", label: "Audience", icon: UsersRound },
      { id: "publish", label: "Publish", icon: Send },
    ],
  },
  {
    label: "Workspace",
    items: [{ id: "settings", label: "Settings", icon: Settings2 }],
  },
];

const MOBILE_NAV: Array<{ id: "campaign" | "media" | "copy" | "publish"; label: string; icon: LucideIcon }> = [
  { id: "campaign", label: "Ad", icon: Target },
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "copy", label: "Copy", icon: Type },
  { id: "publish", label: "Publish", icon: Send },
];

export function AdStudioWorkbench({
  brandKit,
  campaignPack: initialPack,
  offers,
}: AdStudioWorkbenchProps) {
  const [pack, setPack] = useState(initialPack);
  const [newAdOpen, setNewAdOpen] = useState(false);
  const [newAdTemplateId, setNewAdTemplateId] = useState<string | undefined>(undefined);
  const [promptedForFirstAd, setPromptedForFirstAd] = useState(false);
  const [selectedAngleId, setSelectedAngleId] = useState("free_appraisal");
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>("story");
  const previewMode: PreviewMode = "platform";
  const zoom = 75;
  const [selectedElement, setSelectedElement] = useState<SelectedElement>("headline");
  const [campaignGoal, setCampaignGoal] = useState("Get appraisal leads");
  const [offerLabel, setOfferLabel] = useState("Free appraisal");
  const [market, setMarket] = useState("South Perth, WA");
  const [propertyType, setPropertyType] = useState("Houses");
  const [leadDestination, setLeadDestination] = useState("Landing page");
  const [destinationUrl, setDestinationUrl] = useState("northstarrealty.com.au/free-appraisal");

  const studio = useAdStudio();
  const { brand, initials, domain } = useBrandKit(brandKit);
  const {
    copy,
    setCopy,
    updateCopy,
    copyMode,
    setCopyMode,
    brief,
    setBrief,
    generating,
    alternates,
    generateCopy,
    applyCopyAssist,
    applyAlternate,
  } = useCopy(initialPack, studio.setSaveState, studio.showToast, setSelectedElement);

  const copyContext = {
    goal: campaignGoal,
    offer: offerLabel,
    market,
    propertyType,
    businessName: brand,
  };

  function openNewAd(templateId?: string) {
    setNewAdTemplateId(templateId);
    setNewAdOpen(true);
  }
  const { primaryImage, setPrimaryImage, fileInputRef, replaceImage, openFilePicker } = useMedia(
    studio.showToast,
    () => {
      setSelectedElement("image");
      studio.setSection("media");
    },
  );
  const { readinessItems } = useReadiness({
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
  //   POST /api/adstudio/campaigns — Generate variants
  //   PATCH /api/adstudio/campaigns/${currentPack.campaign.campaignId}/draft — save draft
  //   POST /api/adstudio/export-packages/${currentPack.campaign.campaignId}/download — Export creatives
  //   platforms: ["meta"]
  // Campaign readiness checklist lives in the publish panel.
  const { generateFirstAd, generateVariantsForAngle, saveDraft, exportCreatives } = useCampaignActions({
    pack,
    brandKit,
    offers,
    market,
    copy,
    offerLabel,
    campaignGoal,   // M4: pass goal so generation includes it
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
    setSelectedAngleId,
    showToast: studio.showToast,
  });

  // H9: delete campaign with confirmation — lives in publish panel (ownership boundary)
  async function deleteCampaign() {
    if (!window.confirm("Delete this campaign? This cannot be undone.")) return;
    const res = await fetch(`/api/adstudio/campaigns/${pack.campaign.campaignId}`, { method: "DELETE" });
    if (res.ok) {
      window.location.href = "/";
    } else {
      studio.showToast("Could not delete campaign");
    }
  }

  const selectedAngle = ANGLES.find((angle) => angle.id === selectedAngleId) ?? ANGLES[0];

  useEffect(() => {
    if (!promptedForFirstAd && pack.variants.length === 0) {
      setPromptedForFirstAd(true);
      setNewAdOpen(true);
    }
  }, [pack.variants.length, promptedForFirstAd]);

  // M6: derive per-section completion state from readiness items for rail indicators
  // Computed inline at render time — no extra memo needed (readinessItems is already memoised)
  const format = FORMAT_META[previewFormat];
  const campaignName = pack.campaign.name || "Ad draft";

  const variants = useMemo(() => {
    const source = pack.variants.length > 0 ? pack.variants : initialPack.variants;
    return source.slice(0, 4).map((variant, index) => ({
      ...variant,
      displayName: `Ad ${index + 1}`,
      // M5: use the variant's own angle field as the label — not an index-offset into ANGLES
      angleLabel: variant.angle || selectedAngle.variantLabel,
      image: MEDIA_ASSETS[index % MEDIA_ASSETS.length].src,
    }));
  }, [initialPack.variants, pack.variants, selectedAngle.variantLabel]);

  function selectVariant(index: number) {
    setSelectedVariantIndex(index);
    setCopy(seedCopy(pack, index));
    setPrimaryImage(MEDIA_ASSETS[index % MEDIA_ASSETS.length].src);
  }

  // Adds another generated ad idea from the current defaults.
  function addVariant() {
    generateVariantsForAngle(selectedAngle);
  }

  function renderPanel() {
    if (studio.section === "templates") {
      return (
        <TemplatesPanel
          templates={AD_STUDIO_TEMPLATES}
          onUseTemplate={(id) => openNewAd(id)}
          onStartBlank={() => openNewAd("")}
        />
      );
    }
    if (studio.section === "brand") {
      return <BrandPanel brand={brand} brandKit={brandKit} />;
    }
    if (studio.section === "media") {
      // 1a: wire onSelectImage so library tiles actually update the primary image
      return <MediaPanel primaryImage={primaryImage} openFilePicker={openFilePicker} onSelectImage={setPrimaryImage} />;
    }
    if (studio.section === "copy") {
      return (
        <CopyPanel
          copy={copy}
          updateCopy={updateCopy}
          copyMode={copyMode}
          setCopyMode={setCopyMode}
          brief={brief}
          setBrief={setBrief}
          generating={generating}
          alternates={alternates}
          context={copyContext}
          onGenerate={(kind, context) => void generateCopy(kind, context)}
          onAssist={(action, context) => void applyCopyAssist(action, context)}
          onApplyAlternate={applyAlternate}
        />
      );
    }
    if (studio.section === "audience") {
      return <AudiencePanel />;
    }
    if (studio.section === "publish") {
      // M1: wire real props; H9: pass deleteCampaign
      return (
        <PublishSetupPanel
          campaignId={pack.campaign.campaignId}
          campaignPack={pack}
          destinationUrl={destinationUrl}
          onExport={exportCreatives}
          onDelete={deleteCampaign}
        />
      );
    }
    if (studio.section === "settings") {
      return <SettingsPanel />;
    }
    return (
      <CampaignPanel
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
        variantCount={pack.variants.length}
        onCreateAd={() => openNewAd()}
        onBrowseTemplates={() => studio.setSection("templates")}
        templates={AD_STUDIO_TEMPLATES}
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
        onSave={saveDraft}
        onDelete={deleteCampaign}
        campaignId={pack.campaign.campaignId}
        showToast={studio.showToast}
      />

      <div className="studio-desktop-body">
        <aside className="studio-rail" aria-label="Ad Studio sections">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} style={{ display: "grid", gap: 2 }}>
              <span className="studio-rail-label">{group.label}</span>
              {group.items.map((item) => {
                const Icon = item.icon;

                // M6: map readiness items to section, derive dot state
                const sectionItems: Record<string, string[]> = {
                  campaign: ["Goal & offer", "Location", "Property type"],
                  media: ["Primary media"],
                  copy: ["Ad copy", "Call to action"],
                  brand: [],   // special-cased below
                  publish: [], // all items
                };
                let railState: "done" | "warn" | "todo" | null = null;
                if (item.id === "brand") {
                  railState = brandKit.reviewStatus === "approved" ? "done" : "warn";
                } else if (item.id === "publish") {
                  const allDone = readinessItems.every((ri) => ri.state === "done");
                  railState = allDone ? "done" : readinessItems.some((ri) => ri.state === "warn") ? "warn" : "todo";
                } else {
                  const labels = sectionItems[item.id] ?? [];
                  if (labels.length > 0) {
                    const relevant = readinessItems.filter((ri) => labels.includes(ri.label));
                    if (relevant.length > 0) {
                      if (relevant.every((ri) => ri.state === "done")) railState = "done";
                      else if (relevant.some((ri) => ri.state === "warn")) railState = "warn";
                      else railState = "todo";
                    }
                  }
                }

                return (
                  <button
                    className={studio.section === item.id ? "active" : ""}
                    key={item.id}
                    type="button"
                    onClick={() => studio.setSection(item.id)}
                  >
                    <Icon aria-hidden size={18} />
                    <span>{item.label}</span>
                    {railState === "done" && <Check aria-hidden size={13} style={{ color: "#0e7a4d", marginLeft: "auto", flexShrink: 0 }} />}
                    {railState === "warn" && <CircleAlert aria-hidden size={13} style={{ color: "#ffb020", marginLeft: "auto", flexShrink: 0 }} />}
                    {railState === "todo" && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#e2e5ea", marginLeft: "auto", flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <section className="studio-left-panel" aria-label={`${studio.section} setup`}>
          {renderPanel()}
        </section>

        <section className="studio-preview-column" aria-label="Ad preview">
          <PreviewControls
            previewFormat={previewFormat}
            setPreviewFormat={setPreviewFormat}
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
                studio.setSection(element === "image" ? "media" : "copy");
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

          <VariantStrip
            variants={variants}
            selectedVariantIndex={selectedVariantIndex}
            onSelect={selectVariant}
            onAdd={() => openNewAd()}
            onEditCopy={(index) => {
              selectVariant(index);
              studio.setSection("copy");
            }}
            onReplaceImage={(index) => {
              selectVariant(index);
              studio.setSection("media");
              openFilePicker();
            }}
            onRegenerate={(index) => {
              const variant = pack.variants[index];
              const angle = variant ? (ANGLES.find((a) => a.id === variant.angle) ?? selectedAngle) : selectedAngle;
              void generateVariantsForAngle(angle);
            }}
          />
        </section>
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
                studio.setMobileTab(element === "image" ? "media" : "copy");
              }}
            />
          </div>
        )}

        {studio.mobileTab === "media" && (
          <div className="studio-mobile-panel">
            <VariantStrip
              variants={variants}
              selectedVariantIndex={selectedVariantIndex}
              onSelect={selectVariant}
              onAdd={() => openNewAd()}
              onEditCopy={(index) => {
                selectVariant(index);
                studio.setMobileTab("copy");
              }}
              onReplaceImage={(index) => {
                selectVariant(index);
                openFilePicker();
              }}
              onRegenerate={(index) => {
                const variant = pack.variants[index];
                const angle = variant ? (ANGLES.find((a) => a.id === variant.angle) ?? selectedAngle) : selectedAngle;
                void generateVariantsForAngle(angle);
              }}
            />
          </div>
        )}

        {studio.mobileTab === "copy" && (
          <div className="studio-mobile-panel">
            <CopyPanel
              copy={copy}
              updateCopy={updateCopy}
              copyMode={copyMode}
              setCopyMode={setCopyMode}
              brief={brief}
              setBrief={setBrief}
              generating={generating}
              alternates={alternates}
              context={copyContext}
              onGenerate={(kind, context) => void generateCopy(kind, context)}
              onAssist={(action, context) => void applyCopyAssist(action, context)}
              onApplyAlternate={applyAlternate}
            />
          </div>
        )}

        {studio.mobileTab === "publish" && (
          <div className="studio-mobile-panel">
            <PublishSetupPanel
              campaignId={pack.campaign.campaignId}
              campaignPack={pack}
              destinationUrl={destinationUrl}
              onExport={exportCreatives}
              onDelete={deleteCampaign}
            />
          </div>
        )}

        <div className="studio-mobile-variants">
          <VariantStrip variants={variants} selectedVariantIndex={selectedVariantIndex} onSelect={selectVariant} compact />
        </div>
      </div>

      <footer className="studio-statusbar">
        {/* L5: data-state attribute lets CSS color the save chip; existing .error class also applies */}
        <span className={studio.saveState === "error" ? "error" : ""} data-state={studio.saveState}>{studio.statusText}</span>
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

      <NewAdDialog
        open={newAdOpen}
        onClose={() => {
          setNewAdOpen(false);
          setNewAdTemplateId(undefined);
        }}
        templates={AD_STUDIO_TEMPLATES}
        onGenerate={generateFirstAd}
        initialTemplateId={newAdTemplateId}
      />

      {studio.toast && <div className="studio-toast">{studio.toast}</div>}
    </main>
  );
}
