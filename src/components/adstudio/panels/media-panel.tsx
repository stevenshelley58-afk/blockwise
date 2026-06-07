"use client";

import { AssetUploadDropzone } from "@/components/asset-upload-dropzone";
import { AD_IMAGE_MAX_BYTES, AD_IMAGE_UPLOAD_TYPES } from "@/lib/upload/asset-file";

import { PanelHeader } from "../inspector";
import { MEDIA_ASSETS } from "../use-media";

type MediaPanelProps = {
  primaryImage: string;
  primaryImageName?: string;
  openFilePicker: () => void;
  onUploadImage: (file: File) => void | Promise<void>;
  onUploadRejected: (message: string) => void;
  onSelectImage?: (src: string) => void;
};

export function MediaPanel({
  primaryImage,
  primaryImageName,
  openFilePicker,
  onUploadImage,
  onUploadRejected,
  onSelectImage,
}: MediaPanelProps) {
  const selectedAsset = MEDIA_ASSETS.find((asset) => asset.src === primaryImage);
  const currentLabel = selectedAsset?.label ?? primaryImageName ?? "Uploaded image";

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
      <AssetUploadDropzone
        className="studio-media-upload"
        label="Upload image"
        actionText="Upload image"
        helperText="PNG, JPG or WebP / up to 8 MB"
        previewUrl={primaryImage}
        previewAlt=""
        fileName={currentLabel}
        fileType={selectedAsset?.type ?? "Uploaded image"}
        acceptedTypes={AD_IMAGE_UPLOAD_TYPES}
        maxBytes={AD_IMAGE_MAX_BYTES}
        typeError="Use a JPG, PNG, or WebP image."
        sizeError="Use an image under 8 MB."
        capturePagePaste
        onFileAccepted={onUploadImage}
        onFileRejected={onUploadRejected}
      />
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
            <small>{primaryImage === asset.src ? "Primary / in use" : `${asset.type} / ${asset.ratio}`}</small>
          </button>
        ))}
      </div>
    </>
  );
}
