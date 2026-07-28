"use client";

import { useCallback, useRef, useState } from "react";

import {
  AD_IMAGE_MAX_BYTES,
  AD_IMAGE_UPLOAD_TYPES,
  validateAssetUploadFile,
} from "@/lib/upload/asset-file";

import { uploadAdStudioMedia } from "./media-upload";

import type { AssetRole } from "./asset-roles";

export type { AssetRole };

// Demo imagery for the sample workspace. These ship with the app, so the
// displayed and generated sources are the same file.
export const MEDIA_ASSETS = [
  { src: "/ads/ad-northstar.jpg", fullSrc: "/ads/ad-northstar.jpg", label: "South Perth skyline", type: "Uploaded", ratio: "Story", role: "background" },
  { src: "/ads/ad-hillview.jpg", fullSrc: "/ads/ad-hillview.jpg", label: "Modern family home", type: "Property image", ratio: "Feed", role: "property" },
  { src: "/ads/ad-hillco.jpg", fullSrc: "/ads/ad-hillco.jpg", label: "Living room hero", type: "Brand asset", ratio: "Square", role: "property" },
  { src: "/ads/ad-coastline.jpg", fullSrc: "/ads/ad-coastline.jpg", label: "River market view", type: "Previously used", ratio: "Landscape", role: "background" },
];

export function useMedia(
  showToast: (message: string) => void,
  onImageSelected?: () => void,
  options: {
    initialImage?: { src: string; label: string } | null;
    workspaceId: string;
    brandKitId: string;
    onUploaded?: (asset: { src: string; label: string }) => void;
    isSample?: boolean;
  } = { workspaceId: "", brandKitId: "" },
) {
  const demoFallback = options.isSample ? MEDIA_ASSETS[0] : null;
  const initialPrimaryImage = options.initialImage?.src ?? demoFallback?.src ?? "";
  const initialPrimaryImageName = options.initialImage?.label ?? demoFallback?.label ?? "";
  const [primaryImage, setPrimaryImageState] = useState(() => initialPrimaryImage);
  const [primaryImageName, setPrimaryImageNameState] = useState(() => initialPrimaryImageName);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadRequestRef = useRef(0);
  const committedPrimaryImageRef = useRef(initialPrimaryImage);
  const committedPrimaryImageNameRef = useRef(initialPrimaryImageName);

  const commitPrimaryImage = useCallback((src: string, label: string) => {
    committedPrimaryImageRef.current = src;
    committedPrimaryImageNameRef.current = label;
    setPrimaryImageState(src);
    setPrimaryImageNameState(label);
  }, []);

  const setPrimaryImage = useCallback((src: string) => {
    uploadRequestRef.current += 1;
    committedPrimaryImageRef.current = src;
    setPrimaryImageState(src);
  }, []);

  const setPrimaryImageName = useCallback((label: string) => {
    committedPrimaryImageNameRef.current = label;
    setPrimaryImageNameState(label);
  }, []);

  async function replaceImage(
    file: File | null | undefined,
    optionsOverride: { commit?: boolean } = {},
  ): Promise<{ src: string; label: string } | undefined> {
    if (!file) return undefined;
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

    const uploadRequestId = uploadRequestRef.current + 1;
    uploadRequestRef.current = uploadRequestId;
    const isCurrentUpload = () => uploadRequestRef.current === uploadRequestId;

    // Paint the picked image instantly so the upload never feels dead, then swap
    // to the stored URL once it lands (or revert if the upload fails).
    const commit = optionsOverride.commit !== false;
    const localPreview = commit ? URL.createObjectURL(file) : "";
    if (commit) {
      setPrimaryImageState(localPreview);
      setPrimaryImageNameState(file.name);
      onImageSelected?.();
    }

    try {
      const result = await uploadAdStudioMedia({
        file,
        workspaceId: options.workspaceId,
        brandKitId: options.brandKitId,
      });
      if (!isCurrentUpload()) return undefined;
      const uploaded = { src: result.src, label: file.name };
      if (commit) commitPrimaryImage(uploaded.src, uploaded.label);
      options.onUploaded?.(uploaded);
      showToast(commit ? "Image added to this ad" : "Image added to your library");
      return uploaded;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not upload that image.";
      if (commit && isCurrentUpload()) {
        commitPrimaryImage(committedPrimaryImageRef.current, committedPrimaryImageNameRef.current);
        showToast(message);
      }
      throw new Error(message);
    } finally {
      // Free the blob once the <img> has swapped to the stored (or reverted) URL.
      if (localPreview) setTimeout(() => URL.revokeObjectURL(localPreview), 15_000);
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  return { primaryImage, setPrimaryImage, primaryImageName, setPrimaryImageName, fileInputRef, replaceImage, openFilePicker };
}
