"use client";

import { useCallback, useMemo } from "react";

import type { AdStudioCampaignPack, AdStudioFormat } from "@/lib/adstudio";

import type { AngleCard } from "./angles";
import type { CopyState } from "./use-copy";
import { seedCopy } from "./use-copy";
import { MEDIA_ASSETS } from "./use-media";
import { commitVariantEdits, primaryImageForVariant } from "./workbench-helpers";

export type WorkbenchVariant = AdStudioCampaignPack["variants"][number] & {
  displayName: string;
  angleLabel: string;
  image: string;
};

type UseWorkbenchVariantsInput = {
  pack: AdStudioCampaignPack;
  initialPack: AdStudioCampaignPack;
  isSample: boolean;
  editorFormat: AdStudioFormat;
  selectedAngle: AngleCard;
  selectedVariantId: string | undefined;
  selectedVariantIndex: number;
  copy: CopyState;
  offerLabel: string;
  primaryImage: string;
  setPack: (pack: AdStudioCampaignPack) => void;
  setSelectedVariantIndex: (index: number) => void;
  setCopy: (copy: CopyState) => void;
  setPrimaryImage: (src: string) => void;
  setPrimaryImageName: (label: string) => void;
  saveDraft: (options?: {
    silent?: boolean;
    packOverride?: AdStudioCampaignPack;
    variantIdOverride?: string;
    copyOverride?: CopyState;
    primaryImageOverride?: string;
    offerLabelOverride?: string;
  }) => Promise<boolean>;
};

/** Variant strip data plus selection: committing edits to the outgoing variant
 * and restoring the incoming variant's own copy and image. */
export function useWorkbenchVariants(input: UseWorkbenchVariantsInput) {
  const {
    pack,
    initialPack,
    isSample,
    editorFormat,
    selectedAngle,
    selectedVariantId,
    selectedVariantIndex,
    copy,
    offerLabel,
    primaryImage,
    setPack,
    setSelectedVariantIndex,
    setCopy,
    setPrimaryImage,
    setPrimaryImageName,
    saveDraft,
  } = input;

  const getVariantPrimaryImage = useCallback((variantId: string | undefined, sourcePack: AdStudioCampaignPack = pack) => {
    return primaryImageForVariant(sourcePack, variantId, editorFormat);
  }, [editorFormat, pack]);

  const variants = useMemo<WorkbenchVariant[]>(() => {
    const source = pack.variants.length > 0 ? pack.variants : initialPack.variants;
    return source.slice(0, 4).map((variant, index) => {
        const variantImage = getVariantPrimaryImage(variant.variantId);
      return {
        ...variant,
        displayName: `Ad ${index + 1}`,
      // M5: use the variant's own angle field as the label, not an index-offset into ANGLES
        angleLabel: variant.angle || selectedAngle.variantLabel,
        image: variantImage?.src ?? (isSample && MEDIA_ASSETS.some((item) => item.src === primaryImage) ? MEDIA_ASSETS[index % MEDIA_ASSETS.length].src : primaryImage),
      };
    });
  }, [getVariantPrimaryImage, initialPack.variants, pack.variants, primaryImage, selectedAngle.variantLabel, selectedVariantIndex]);

  function selectVariant(index: number) {
    const nextPack = commitVariantEdits({
      pack,
      variantId: selectedVariantId,
      copy,
      offerLabel,
      primaryImage,
    });
    const asset = isSample ? MEDIA_ASSETS[index % MEDIA_ASSETS.length] : null;
    const variant = nextPack.variants[index] ?? initialPack.variants[index];
    const variantImage = getVariantPrimaryImage(variant?.variantId, nextPack);
    const currentIsLibraryAsset = isSample && MEDIA_ASSETS.some((item) => item.src === primaryImage);
    void saveDraft({
      silent: true,
      packOverride: nextPack,
      variantIdOverride: selectedVariantId,
      copyOverride: copy,
      primaryImageOverride: primaryImage,
      offerLabelOverride: offerLabel,
    });
    setPack(nextPack);
    setSelectedVariantIndex(index);
    setCopy(seedCopy(nextPack, index));
    if (variantImage) {
      setPrimaryImage(variantImage.src);
      setPrimaryImageName(variantImage.label);
    } else if (currentIsLibraryAsset && asset) {
      setPrimaryImage(asset.src);
      setPrimaryImageName(asset.label);
    }
  }

  return { variants, selectVariant };
}
