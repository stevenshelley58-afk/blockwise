"use client";

import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";

import type { AdStudioBrandKit, AdStudioCreative } from "@/lib/adstudio";

import { AdPreview, PreviewControls, VariantStrip } from "./preview";
import type { PreviewFormat, SelectedElement } from "./preview";
import type { GenerationProgress } from "./use-campaign-actions";
import type { CopyState } from "./use-copy";
import type { WorkbenchVariant } from "./use-workbench-variants";

const FabricAdEditor = dynamic(
  () => import("./canvas/fabric-ad-editor").then((mod) => mod.FabricAdEditor),
  { ssr: false, loading: () => <div className="studio-fabric-loading">Loading editor...</div> },
);

type WorkbenchPreviewColumnProps = {
  previewFormat: PreviewFormat;
  setPreviewFormat: (format: PreviewFormat) => void;
  brandKit: AdStudioBrandKit;
  brand: string;
  domain: string;
  initials: string;
  copy: CopyState;
  currentCreative: AdStudioCreative | null;
  primaryImage: string;
  selectedElement: SelectedElement;
  busy: boolean;
  busyMessage: string;
  onCopyChange: (key: keyof CopyState, value: string) => void;
  onCreativeChange: (creative: AdStudioCreative) => void;
  onImageChange: (src: string) => void;
  onPatchSelectedLayer: () => void | Promise<void>;
  onRequestImageReplace: () => void;
  onElementSelect: (element: SelectedElement) => void;
  variants: WorkbenchVariant[];
  selectedVariantIndex: number;
  onSelectVariant: (index: number) => void;
  onAddVariant: () => void;
  pending: GenerationProgress | null;
  onRetryPending: () => void;
  onDismissPending: () => void;
  onEditCopy: (index: number) => void;
  onReplaceImage: (index: number) => void;
  onRegenerate: (index: number) => void;
};

export function WorkbenchPreviewColumn({
  previewFormat,
  setPreviewFormat,
  brandKit,
  brand,
  domain,
  initials,
  copy,
  currentCreative,
  primaryImage,
  selectedElement,
  busy,
  busyMessage,
  onCopyChange,
  onCreativeChange,
  onImageChange,
  onPatchSelectedLayer,
  onRequestImageReplace,
  onElementSelect,
  variants,
  selectedVariantIndex,
  onSelectVariant,
  onAddVariant,
  pending,
  onRetryPending,
  onDismissPending,
  onEditCopy,
  onReplaceImage,
  onRegenerate,
}: WorkbenchPreviewColumnProps) {
  const zoom = previewFormat === "feed" ? 58 : 68;

  return (
    <section className="studio-preview-column" aria-label="Ad preview">
      <PreviewControls
        previewFormat={previewFormat}
        setPreviewFormat={setPreviewFormat}
      />

      <div className="studio-stage">
        {currentCreative ? (
          <FabricAdEditor
            brandKit={brandKit}
            copy={copy}
            creative={currentCreative}
            imageSrc={primaryImage}
            selectedElement={selectedElement}
            onCopyChange={onCopyChange}
            onCreativeChange={onCreativeChange}
            onImageChange={onImageChange}
            onPatchSelectedLayer={onPatchSelectedLayer}
            onRequestImageReplace={onRequestImageReplace}
            onSelectedElementChange={onElementSelect}
          />
        ) : (
          <AdPreview
            brand={brand}
            domain={domain}
            initials={initials}
            copy={copy}
            image={primaryImage}
            format={previewFormat}
            zoom={zoom}
            selectedElement={selectedElement}
            setSelectedElement={onElementSelect}
          />
        )}
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

      <VariantStrip
        variants={variants}
        selectedVariantIndex={selectedVariantIndex}
        onSelect={onSelectVariant}
        onAdd={onAddVariant}
        pending={pending}
        onRetryPending={onRetryPending}
        onDismissPending={onDismissPending}
        onEditCopy={onEditCopy}
        onReplaceImage={onReplaceImage}
        onRegenerate={onRegenerate}
      />
    </section>
  );
}
