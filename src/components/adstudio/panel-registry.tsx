"use client";

import type { ComponentType } from "react";
import * as React from "react";

import type { AdStudioBrandKit, AdStudioCampaignPack, AdStudioFormat, AdStudioOfferTemplate, AdStudioTemplate, FirstAdInput } from "@/lib/adstudio";

import { BrandPanel } from "./panels/brand-panel";
import { CampaignPanel } from "./panels/campaign-panel";
import { CopyPanel } from "./panels/copy-panel";
import { MediaPanel } from "./panels/media-panel";
import { PublishSetupPanel } from "./panels/publish-panel";
import { TemplatesPanel } from "./panels/templates-panel";
import type { StudioSection } from "./use-ad-studio";
import type { CopyAlternates, CopyContext, CopyFeedback, CopyMode, CopyState } from "./use-copy";
import type { ExportFormatStatus } from "./use-campaign-actions";

/**
 * Per-panel props. Each panel only declares the props it actually needs;
 * the registry fills them in from the workbench's state.
 */
export type PanelProps = {
  campaign: {
    campaignGoal: string;
    setCampaignGoal: (value: string) => void;
    offerLabel: string;
    setOfferLabel: (value: string) => void;
    market: string;
    setMarket: (value: string) => void;
    propertyType: string;
    setPropertyType: (value: string) => void;
    destinationUrl: string;
    setDestinationUrl: (value: string) => void;
    offers: AdStudioOfferTemplate[];
    variantCount: number;
    onCreateAd: () => void;
    onBrowseTemplates: () => void;
    templates: AdStudioTemplate[];
  };
  templates: {
    templates: AdStudioTemplate[];
    onUseTemplate: (id: string) => void;
    onStartBlank: () => void;
  };
  brand: {
    brand: string;
    brandKit: AdStudioBrandKit;
  };
  media: {
    primaryImage: string;
    primaryImageName: string;
    openFilePicker: () => void;
    onUploadImage: (file: File) => void | Promise<void>;
    onUploadRejected: (message: string) => void;
    onSelectImage: (src: string) => void;
    mediaAssets: ReadonlyArray<{ src: string; label: string; type: string; ratio: string }>;
    onGenerateBackground: () => void;
    generatingBackground: boolean;
  };
  copy: {
    copy: CopyState;
    updateCopy: (key: keyof CopyState, value: string) => void;
    copyMode: CopyMode;
    setCopyMode: (mode: CopyMode) => void;
    brief: string;
    setBrief: (value: string) => void;
    generating: boolean;
    feedback: CopyFeedback | null;
    alternates: CopyAlternates;
    context: CopyContext;
    onGenerate: (kind: "ai" | "brief", context: CopyContext) => void;
    onAssist: (action: string, context: CopyContext) => void;
    onApplyAlternate: (field: "headline" | "primaryText", value: string) => void;
  };
  publish: {
    campaignId: string;
    campaignPack: AdStudioCampaignPack;
    destinationUrl: string;
    onExport: () => void;
    onDelete: () => void;
    brandApproved: boolean;
    exportStatus: ExportFormatStatus[] | null;
    onRetryExportFormat: (format: AdStudioFormat) => void;
  };
};

export type PanelMap = {
  [K in StudioSection]: ComponentType<PanelProps[K]>;
};

/**
 * The component the workbench renders for each rail section. Adding a new
 * section means adding an entry here (and the type narrows automatically).
 */
export const PANELS: PanelMap = {
  campaign: (props) => <CampaignPanel {...props} />,
  templates: (props) => (
    <TemplatesPanel
      templates={props.templates}
      onUseTemplate={props.onUseTemplate}
      onStartBlank={props.onStartBlank}
    />
  ),
  brand: (props) => <BrandPanel brand={props.brand} brandKit={props.brandKit} />,
  media: (props) => (
    <MediaPanel
      primaryImage={props.primaryImage}
      primaryImageName={props.primaryImageName}
      openFilePicker={props.openFilePicker}
      onUploadImage={props.onUploadImage}
      onUploadRejected={props.onUploadRejected}
      onSelectImage={props.onSelectImage}
      mediaAssets={props.mediaAssets as never}
      onGenerateBackground={props.onGenerateBackground}
      generatingBackground={props.generatingBackground}
    />
  ),
  copy: (props) => (
    <CopyPanel
      copy={props.copy}
      updateCopy={props.updateCopy}
      copyMode={props.copyMode}
      setCopyMode={props.setCopyMode}
      brief={props.brief}
      setBrief={props.setBrief}
      generating={props.generating}
      feedback={props.feedback}
      alternates={props.alternates}
      context={props.context}
      onGenerate={props.onGenerate}
      onAssist={props.onAssist}
      onApplyAlternate={props.onApplyAlternate}
    />
  ),
  publish: (props) => (
    <PublishSetupPanel
      campaignId={props.campaignId}
      campaignPack={props.campaignPack}
      destinationUrl={props.destinationUrl}
      onExport={props.onExport}
      onDelete={props.onDelete}
      brandApproved={props.brandApproved}
      exportStatus={props.exportStatus}
      onRetryExportFormat={props.onRetryExportFormat}
    />
  ),
};

// Silence unused import warnings for FirstAdInput (re-exported for convenience).
export type { FirstAdInput };
export type PanelComponent<K extends StudioSection> = ComponentType<PanelProps[K]>;
