"use client";

import { Upload } from "lucide-react";

import { MEDIA_ASSETS } from "../use-media";
import { PanelHeader } from "../inspector";

type MediaPanelProps = {
  primaryImage: string;
  openFilePicker: () => void;
  onSelectImage?: (src: string) => void;
};

export function MediaPanel({ primaryImage, openFilePicker, onSelectImage }: MediaPanelProps) {
  const selectedAsset = MEDIA_ASSETS.find((asset) => asset.src === primaryImage);
  const currentLabel = selectedAsset?.label ?? "Uploaded image";

  return (
    <>
      <PanelHeader title="Media" detail="Your images and the generated ad sizes." />
      <div className="studio-current-media" aria-label="Current image">
        <img src={primaryImage} alt="" />
        <span>
          <strong>Current image</strong>
          <small>{currentLabel}</small>
        </span>
        <button type="button" onClick={openFilePicker}>
          Replace
        </button>
      </div>
      <button className="studio-upload-card" type="button" onClick={openFilePicker}>
        <span className="studio-upload-ic">
          <Upload aria-hidden size={17} />
        </span>
        <span>
          <strong>Upload image</strong>
          <small>PNG, JPG or WebP · up to 8 MB</small>
        </span>
      </button>
      <div className="studio-media-grid">
        {MEDIA_ASSETS.map((asset) => (
          <button
            className={primaryImage === asset.src ? "active" : ""}
            key={asset.src}
            type="button"
            onClick={() => onSelectImage?.(asset.src)}
          >
            <img src={asset.src} alt="" />
            <span>{asset.label}</span>
            <small>{primaryImage === asset.src ? "Primary · in use" : `${asset.type} / ${asset.ratio}`}</small>
          </button>
        ))}
      </div>
    </>
  );
}
