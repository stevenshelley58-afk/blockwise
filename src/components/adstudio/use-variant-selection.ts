"use client";

import { useCallback, useMemo, useState } from "react";

import type { AdStudioCampaignPack, AdStudioCreative, AdStudioOfferTemplate } from "@/lib/adstudio";
import { applyEditsToPack, type DraftEdits } from "@/lib/adstudio/apply-edits-to-pack";

import type { CopyState } from "./use-copy";
import { seedCopy } from "./use-copy";

/**
 * Owns the pack state and the currently-selected variant. Also exposes
 * `currentCreative` (the creative for the canvas) and `selectVariant`, which
 * commits the current variant's in-flight edits into the pack and returns
 * the new state for the workbench to apply.
 *
 * The workbench is responsible for rendering the variant strip (because the
 * image fallback depends on `primaryImage` from `useMedia`); this hook
 * provides the raw variant data and a stable switch action.
 */
export function useVariantSelection({
  initialPack,
}: {
  initialPack: AdStudioCampaignPack;
  /** Reserved for future filters — currently unused. */
  offers?: AdStudioOfferTemplate[];
}) {
  const [pack, setPack] = useState(initialPack);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);

  const selectedVariant = pack.variants[selectedVariantIndex] ?? pack.variants[0];

  /**
   * Commit the current variant's in-flight edits (copy / offer / image / market)
   * into the pack, then switch. Returns the new state for the workbench to
   * apply (pack via setPack, copy via setCopy, image via setPrimaryImage).
   */
  const selectVariant = useCallback(
    (index: number, edits: Omit<DraftEdits, "pack" | "variantId">) => {
      const draftEdits: DraftEdits = {
        ...edits,
        pack,
        variantId: selectedVariant?.variantId,
      };
      const nextPack = applyEditsToPack(draftEdits);
      const nextCopy = seedCopy(nextPack, index);
      return { nextPack, nextCopy, index };
    },
    [pack, selectedVariant],
  );

  // The creative matching the selected variant. The canvas re-mounts when
  // the variant changes, so we don't need format-aware lookup here.
  const currentCreative = useMemo<AdStudioCreative | null>(() => {
    const variantId = selectedVariant?.variantId;
    return (
      pack.creatives.find((creative) => creative.variantId === variantId) ??
      pack.creatives[0] ??
      null
    );
  }, [pack.creatives, selectedVariant?.variantId]);

  return {
    pack,
    setPack,
    selectedVariantIndex,
    setSelectedVariantIndex,
    selectedVariant,
    selectVariant,
    currentCreative,
  };
}
