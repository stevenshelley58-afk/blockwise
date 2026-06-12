"use client";

import { useMemo, useRef, useState } from "react";

import type { AdStudioBrandKit, AdStudioCampaignPack, AdStudioCreative } from "@/lib/adstudio";

import type { SelectedElement } from "./preview";
import type { StudioSection } from "./use-ad-studio";
import type { CopyContext, CopyState } from "./use-copy";
import { MEDIA_ASSETS, useMedia } from "./use-media";
import { PREVIEW_TO_AD_FORMAT, primaryImageForVariant } from "./workbench-helpers";

export type MediaAsset = { src: string; label: string; type: string; ratio: string };

type UseWorkbenchMediaInput = {
  workspaceId: string;
  brandKit: AdStudioBrandKit;
  isSample: boolean;
  firstRun: boolean;
  initialPack: AdStudioCampaignPack;
  pack: AdStudioCampaignPack;
  currentCreative: AdStudioCreative | null;
  copy: CopyState;
  generating: boolean;
  copyContext: CopyContext;
  generateCopy: (kind: "ai" | "brief", context: CopyContext, imageSrc?: string) => Promise<void>;
  market: string;
  propertyType: string;
  setSelectedElement: (element: SelectedElement) => void;
  setSection: (section: StudioSection) => void;
  setBusy: (busy: boolean) => void;
  setBusyMessage: (message: string) => void;
  setSaveState: (state: "saved" | "saving" | "error") => void;
  showToast: (message: string) => void;
};

export function useWorkbenchMedia(input: UseWorkbenchMediaInput) {
  const {
    workspaceId,
    brandKit,
    isSample,
    firstRun,
    initialPack,
    pack,
    currentCreative,
    copy,
    generating,
    copyContext,
    generateCopy,
    market,
    propertyType,
    setSelectedElement,
    setSection,
    setBusy,
    setBusyMessage,
    setSaveState,
    showToast,
  } = input;

  const [uploadedAssets, setUploadedAssets] = useState<MediaAsset[]>([]);
  const [generatingBackground, setGeneratingBackground] = useState(false);

  const initialMedia = useMemo(
    () => primaryImageForVariant(initialPack, initialPack.variants[0]?.variantId, PREVIEW_TO_AD_FORMAT.story),
    [initialPack],
  );
  const { primaryImage, setPrimaryImage, primaryImageName, setPrimaryImageName, fileInputRef, replaceImage, openFilePicker } = useMedia(
    showToast,
    () => {
      setSelectedElement("image");
      setSection("media");
    },
    {
      initialImage: initialMedia,
      workspaceId,
      brandKitId: brandKit.brandKitId,
      isSample,
      onUploaded: (asset) =>
        setUploadedAssets((prev) =>
          prev.some((item) => item.src === asset.src)
            ? prev
            : [{ src: asset.src, label: asset.label, type: "Uploaded", ratio: "Just now" }, ...prev],
        ),
    },
  );

  // Magic moment: the first time a new user adds a photo to an untouched ad, write
  // copy grounded in that photo straight away, so uploading visibly produces an ad
  // instead of just a toast. Gated to first-run + copy still untouched + once per
  // session, so it can never overwrite copy someone has already written or generated.
  const seededCopyRef = useRef(copy);
  const autoDesignedRef = useRef(false);
  async function handleUploadImage(file: File | null | undefined) {
    let uploaded: { src: string; label: string } | undefined;
    try {
      uploaded = await replaceImage(file);
    } catch {
      return; // replaceImage already surfaced the failure to the user
    }
    if (!uploaded) return;
    const copyUntouched =
      copy.primaryText === seededCopyRef.current.primaryText &&
      copy.headline === seededCopyRef.current.headline &&
      copy.description === seededCopyRef.current.description &&
      copy.cta === seededCopyRef.current.cta;
    // Fire on a fresh, untouched ad (first run or no variants yet); never clobber written copy.
    const isNewAd = firstRun || pack.variants.length === 0;
    if (autoDesignedRef.current || generating || !isNewAd || !copyUntouched) return;
    autoDesignedRef.current = true;
    setSection("copy");
    setBusy(true);
    setBusyMessage("Designing your ad from your photo...");
    try {
      await generateCopy("ai", copyContext, uploaded.src);
    } finally {
      setBusy(false);
    }
  }

  const workspaceMediaAssets = useMemo(
    () =>
      [
        ...brandKit.assets.listingImages.map((src, index) => ({
          src,
          label: `Workspace image ${index + 1}`,
          type: "Workspace asset",
          ratio: "Image",
        })),
        ...brandKit.assets.officeImages.map((src, index) => ({
          src,
          label: `Office image ${index + 1}`,
          type: "Brand asset",
          ratio: "Image",
        })),
        ...brandKit.assets.headshots.map((src, index) => ({
          src,
          label: `Agent image ${index + 1}`,
          type: "Brand asset",
          ratio: "Image",
        })),
      ],
    [brandKit.assets.headshots, brandKit.assets.listingImages, brandKit.assets.officeImages],
  );
  // Uploads land at the front of the library so the image you just added is
  // visible and reselectable right away, not only after a reload.
  // Demo/sample imagery is only shown when viewing the sample workspace; real
  // users see only their own uploaded and workspace assets.
  const demoAssets = isSample ? MEDIA_ASSETS : [];
  const mediaAssets = [...uploadedAssets, ...(workspaceMediaAssets.length > 0 ? workspaceMediaAssets : demoAssets)];

  function selectMediaImage(src: string) {
    const asset = mediaAssets.find((item) => item.src === src);
    setPrimaryImage(src);
    setPrimaryImageName(asset?.label ?? "Uploaded image");
    setSelectedElement("image");
    setSaveState("saving");
    showToast("Image selected");
  }

  async function generateBackgroundImage() {
    if (!currentCreative || generatingBackground) return;
    setGeneratingBackground(true);
    setBusy(true);
    setBusyMessage("Generating background");
    try {
      const response = await fetch("/api/adstudio/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: [copy.headline, copy.description, market, propertyType, "real estate advertising background"]
            .filter(Boolean)
            .join(" | "),
          aspectRatio: currentCreative.format,
          stylePreset: "premium_editorial_real_estate",
          brandKitId: brandKit.brandKitId,
          brand: {
            palette: [brandKit.colours.primary, brandKit.colours.secondary, brandKit.colours.accent].filter(Boolean),
            styleTags: brandKit.visualStyle.styleTags,
            imageTreatment: brandKit.visualStyle.imageTreatment,
          },
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { image?: string; error?: string };
      if (!response.ok || !json.image) throw new Error(json.error || "Could not generate background.");
      setPrimaryImage(json.image);
      setPrimaryImageName("Generated background");
      setSelectedElement("image");
      setSaveState("saving");
      showToast("Background generated");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not generate background");
    } finally {
      setGeneratingBackground(false);
      setBusy(false);
    }
  }

  return {
    primaryImage,
    setPrimaryImage,
    primaryImageName,
    setPrimaryImageName,
    fileInputRef,
    openFilePicker,
    handleUploadImage,
    mediaAssets,
    selectMediaImage,
    generateBackgroundImage,
    generatingBackground,
  };
}
