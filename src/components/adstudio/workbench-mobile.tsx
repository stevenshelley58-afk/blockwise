"use client";

import Link from "next/link";
import { ChevronDown, CircleAlert, RefreshCw, Target, X } from "lucide-react";
import type { ReactNode } from "react";

import { CopyPanel } from "./panels/copy-panel";
import { MediaPanel } from "./panels/media-panel";
import { PublishSetupPanel } from "./panels/publish-panel";
import { AdPreview, FORMAT_META, VariantStrip } from "./preview";
import type { PreviewFormat, SelectedElement } from "./preview";
import type { useAdStudio } from "./use-ad-studio";
import type { GenerationProgress } from "./use-campaign-actions";
import type { CopyState } from "./use-copy";
import type { MediaAsset } from "./use-workbench-media";
import type { WorkbenchVariant } from "./use-workbench-variants";
import type { CopyPanelGroupProps, PublishPanelGroupProps } from "./workbench-panels";

type WorkbenchMobileBodyProps = {
  studio: ReturnType<typeof useAdStudio>;
  brandIsDraft: boolean;
  campaignName: string;
  mobileAdDetailsOpen: boolean;
  setMobileAdDetailsOpen: (open: boolean) => void;
  renderCampaignPanel: (options?: { mobileSheet?: boolean }) => ReactNode;
  previewFormat: PreviewFormat;
  setPreviewFormat: (format: PreviewFormat) => void;
  brand: string;
  domain: string;
  initials: string;
  copy: CopyState;
  selectedElement: SelectedElement;
  setSelectedElement: (element: SelectedElement) => void;
  primaryImage: string;
  primaryImageName: string;
  openFilePicker: () => void;
  handleUploadImage: (file: File | null | undefined) => Promise<void>;
  selectMediaImage: (src: string) => void;
  mediaAssets: MediaAsset[];
  generateBackgroundImage: () => Promise<void>;
  generatingBackground: boolean;
  copyPanelProps: CopyPanelGroupProps;
  publishPanelProps: PublishPanelGroupProps;
  variants: WorkbenchVariant[];
  selectedVariantIndex: number;
  selectVariant: (index: number) => void;
  generation: GenerationProgress | null;
  retryPendingGeneration: () => void;
  dismissPendingGeneration: () => void;
};

export function WorkbenchMobileBody({
  studio,
  brandIsDraft,
  campaignName,
  mobileAdDetailsOpen,
  setMobileAdDetailsOpen,
  renderCampaignPanel,
  previewFormat,
  setPreviewFormat,
  brand,
  domain,
  initials,
  copy,
  selectedElement,
  setSelectedElement,
  primaryImage,
  primaryImageName,
  openFilePicker,
  handleUploadImage,
  selectMediaImage,
  mediaAssets,
  generateBackgroundImage,
  generatingBackground,
  copyPanelProps,
  publishPanelProps,
  variants,
  selectedVariantIndex,
  selectVariant,
  generation,
  retryPendingGeneration,
  dismissPendingGeneration,
}: WorkbenchMobileBodyProps) {
  return (
    <>
      <div className="studio-mobile-body">
        {brandIsDraft && (
          <Link href="/ad-studio/brand" className="studio-draft-brand-chip" style={{ marginTop: 14 }}>
            <CircleAlert aria-hidden size={15} />
            <span><b>Draft brand in use.</b> Confirm your brand before publishing.</span>
          </Link>
        )}
        <div className="studio-mobile-campaign">
          <button
            className="studio-mobile-campaign-btn"
            type="button"
            aria-controls="studio-mobile-ad-details"
            aria-expanded={mobileAdDetailsOpen}
            onClick={() => setMobileAdDetailsOpen(true)}
          >
            <Target aria-hidden size={18} />
            {campaignName}
            <ChevronDown aria-hidden size={16} />
          </button>
        </div>

        {mobileAdDetailsOpen && (
          <div
            className="studio-mobile-sheet-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setMobileAdDetailsOpen(false);
            }}
          >
            <section
              id="studio-mobile-ad-details"
              className="studio-mobile-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Ad details"
            >
              <header className="studio-mobile-sheet-head">
                <div>
                  <strong>Ad details</strong>
                  <span>{campaignName}</span>
                </div>
                <button type="button" aria-label="Close ad details" onClick={() => setMobileAdDetailsOpen(false)}>
                  <X aria-hidden size={18} />
                </button>
              </header>
              <div className="studio-mobile-sheet-body">{renderCampaignPanel({ mobileSheet: true })}</div>
            </section>
          </div>
        )}

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
            <MediaPanel
              primaryImage={primaryImage}
              primaryImageName={primaryImageName}
              openFilePicker={openFilePicker}
              onUploadImage={handleUploadImage}
              onUploadRejected={studio.showToast}
              onSelectImage={selectMediaImage}
              mediaAssets={mediaAssets}
              onGenerateBackground={() => void generateBackgroundImage()}
              generatingBackground={generatingBackground}
            />
          </div>
        )}

        {studio.mobileTab === "copy" && (
          <div className="studio-mobile-panel">
            <CopyPanel {...copyPanelProps} />
          </div>
        )}

        {studio.mobileTab === "publish" && (
          <div className="studio-mobile-panel">
            <PublishSetupPanel {...publishPanelProps} />
          </div>
        )}

        <div className="studio-mobile-variants">
          <VariantStrip
            variants={variants}
            selectedVariantIndex={selectedVariantIndex}
            onSelect={selectVariant}
            pending={generation}
            onRetryPending={retryPendingGeneration}
            onDismissPending={dismissPendingGeneration}
            compact
          />
        </div>
      </div>

      {studio.busy && (
        <div className="studio-mobile-busy">
          <RefreshCw aria-hidden size={20} />
          <strong>{studio.busyMessage}</strong>
        </div>
      )}

      {generation && !generation.error && (
        <div className="studio-mobile-busy">
          <RefreshCw aria-hidden size={20} />
          <strong>{generation.phase}</strong>
        </div>
      )}

      <div className="studio-mobile-status" data-state={studio.saveState}>
        {studio.statusText}
      </div>
    </>
  );
}
