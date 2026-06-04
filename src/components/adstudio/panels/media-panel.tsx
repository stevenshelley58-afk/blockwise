"use client";

import { Image as ImageIcon } from "lucide-react";

import { MEDIA_ASSETS } from "../use-media";
import { PanelHeader } from "../inspector";

type MediaPanelProps = {
  primaryImage: string;
  openFilePicker: () => void;
  // NOTE for Wave 2 Integrator: pass onSelectImage={setPrimaryImage} from useMedia
  // in ad-studio-workbench.tsx at the MediaPanel render site.
  onSelectImage?: (src: string) => void;
};

export function MediaPanel({ primaryImage, openFilePicker, onSelectImage }: MediaPanelProps) {
  return (
    <>
      <PanelHeader title="Review ads" detail="Check the generated ad sizes and replace the image if needed." />
      <button className="studio-dropzone" type="button" onClick={openFilePicker}>
        <ImageIcon aria-hidden size={22} />
        <span>Replace image</span>
        <small>PNG or JPG</small>
      </button>
      <div className="studio-media-grid">
        {MEDIA_ASSETS.map((asset) => (
          <button className={primaryImage === asset.src ? "active" : ""} key={asset.src} type="button" onClick={() => onSelectImage?.(asset.src)}>
            <img src={asset.src} alt="" />
            <span>{asset.label}</span>
            <small>{asset.type} / {asset.ratio}</small>
          </button>
        ))}
      </div>
    </>
  );
}
