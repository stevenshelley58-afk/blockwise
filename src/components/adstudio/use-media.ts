"use client";

import { useRef, useState } from "react";

import {
  AD_IMAGE_MAX_BYTES,
  AD_IMAGE_UPLOAD_TYPES,
  validateAssetUploadFile,
} from "@/lib/upload/asset-file";

import { uploadAdStudioMedia } from "./media-upload";

export const MEDIA_ASSETS = [
  { src: "/ads/ad-northstar.jpg", label: "South Perth skyline", type: "Uploaded", ratio: "Story" },
  { src: "/ads/ad-hillview.jpg", label: "Modern family home", type: "Property image", ratio: "Feed" },
  { src: "/ads/ad-hillco.jpg", label: "Living room hero", type: "Brand asset", ratio: "Square" },
  { src: "/ads/ad-coastline.jpg", label: "River market view", type: "Previously used", ratio: "Landscape" },
];

export function useMedia(
  showToast: (message: string) => void,
  onImageSelected?: () => void,
  options: {
    initialImage?: { src: string; label: string } | null;
    workspaceId: string;
    brandKitId: string;
    onUploaded?: (asset: { src: string; label: string }) => void;
  } = { workspaceId: "", brandKitId: "" },
) {
  const [primaryImage, setPrimaryImage] = useState(() => options.initialImage?.src ?? MEDIA_ASSETS[0].src);
  const [primaryImageName, setPrimaryImageName] = useState(() => options.initialImage?.label ?? MEDIA_ASSETS[0].label);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function replaceImage(file: File | null | undefined) {
    if (!file) return;
    const validationError = validateAssetUploadFile(file, {
      acceptedTypes: AD_IMAGE_UPLOAD_TYPES,
      maxBytes: AD_IMAGE_MAX_BYTES,
      typeError: "Use a JPG, PNG, or WebP image.",
      sizeError: "Use an image under 8 MB.",
    });
    if (validationError) {
      showToast(validationError);
      throw new Error(validationError);
    }

    try {
      const result = await uploadAdStudioMedia({
        file,
        workspaceId: options.workspaceId,
        brandKitId: options.brandKitId,
      });
      setPrimaryImage(result.src);
      setPrimaryImageName(file.name);
      options.onUploaded?.({ src: result.src, label: file.name });
      onImageSelected?.();
      showToast("Image added to this ad");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not upload that image.";
      showToast(message);
      throw new Error(message);
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click