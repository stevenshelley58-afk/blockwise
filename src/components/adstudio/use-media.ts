"use client";

import { useRef, useState } from "react";

export const MEDIA_ASSETS = [
  { src: "/ads/ad-northstar.jpg", label: "South Perth skyline", type: "Uploaded", ratio: "Story" },
  { src: "/ads/ad-hillview.jpg", label: "Modern family home", type: "Property image", ratio: "Feed" },
  { src: "/ads/ad-hillco.jpg", label: "Living room hero", type: "Brand asset", ratio: "Square" },
  { src: "/ads/ad-coastline.jpg", label: "River market view", type: "Previously used", ratio: "Landscape" },
];

export function useMedia(showToast: (message: string) => void, onImageSelected?: () => void) {
  const [primaryImage, setPrimaryImage] = useState(MEDIA_ASSETS[0].src);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function replaceImage(files: FileList | null) {
    const file = files?.[0];
    if (!file || !file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setPrimaryImage(String(event.target?.result ?? MEDIA_ASSETS[0].src));
      onImageSelected?.();
      showToast("Image replaced");
    };
    reader.readAsDataURL(file);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  return { primaryImage, setPrimaryImage, fileInputRef, replaceImage, openFilePicker };
}
