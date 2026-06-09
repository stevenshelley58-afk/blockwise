"use client";

import type { ComponentProps, ReactNode } from "react";

import type { AdStudioBrandKit } from "@/lib/adstudio";
import { AD_STUDIO_TEMPLATES } from "@/lib/adstudio";

import { BrandPanel } from "./panels/brand-panel";
import { CampaignPanel } from "./panels/campaign-panel";
import { CopyPanel } from "./panels/copy-panel";
import { MediaPanel } from "./panels/media-panel";
import { PublishSetupPanel } from "./panels/publish-panel";
import { SettingsPanel } from "./panels/settings-panel";
import { TemplatesPanel } from "./panels/templates-panel";
import type { StudioSection } from "./use-ad-studio";

// Prop groups shared by the desktop inspector and the mobile tabs; built once in
// the workbench so both layouts render the panels with identical wiring.
export type MediaPanelGroupProps = ComponentProps<typeof MediaPanel>;
export type CopyPanelGroupProps = ComponentProps<typeof CopyPanel>;
export type PublishPanelGroupProps = ComponentProps<typeof PublishSetupPanel>;

type WorkbenchCampaignPanelProps = Omit<
  ComponentProps<typeof CampaignPanel>,
  "onCreateAd" | "onBrowseTemplates" | "templates"
> & {
  mobileSheet?: boolean;
  onCloseMobileSheet: () => void;
  onOpenNewAd: () => void;
  onOpenTemplatesSection: () => void;
};

export function WorkbenchCampaignPanel({
  mobileSheet,
  onCloseMobileSheet,
  onOpenNewAd,
  onOpenTemplatesSection,
  ...fields
}: WorkbenchCampaignPanelProps) {
  return (
    <CampaignPanel
      {...fields}
      onCreateAd={() => {
        if (mobileSheet) onCloseMobileSheet();
        onOpenNewAd();
      }}
      onBrowseTemplates={() => {
        if (mobileSheet) {
          onCloseMobileSheet();
          onOpenNewAd();
        } else {
          onOpenTemplatesSection();
        }
      }}
      templates={AD_STUDIO_TEMPLATES}
    />
  );
}

type WorkbenchSectionPanelProps = {
  section: StudioSection;
  brand: string;
  brandKit: AdStudioBrandKit;
  onUseTemplate: (templateId: string) => void;
  onStartBlank: () => void;
  media: MediaPanelGroupProps;
  copyPanel: CopyPanelGroupProps;
  publish: PublishPanelGroupProps;
  campaignPanel: ReactNode;
};

export function WorkbenchSectionPanel({
  section,
  brand,
  brandKit,
  onUseTemplate,
  onStartBlank,
  media,
  copyPanel,
  publish,
  campaignPanel,
}: WorkbenchSectionPanelProps) {
  if (section === "templates") {
    return <TemplatesPanel templates={AD_STUDIO_TEMPLATES} onUseTemplate={onUseTemplate} onStartBlank={onStartBlank} />;
  }
  if (section === "brand") {
    return <BrandPanel brand={brand} brandKit={brandKit} />;
  }
  if (section === "media") {
    // 1a: wire onSelectImage so library tiles actually update the primary image
    return <MediaPanel {...media} />;
  }
  if (section === "copy") {
    return <CopyPanel {...copyPanel} />;
  }
  if (section === "publish") {
    // M1: wire real props; H9: pass deleteCampaign
    return <PublishSetupPanel {...publish} />;
  }
  if (section === "settings") {
    return <SettingsPanel />;
  }
  return campaignPanel;
}
