"use client";

import { Image as ImageIcon } from "lucide-react";

import { MEDIA_ASSETS } from "../use-media";
import { PanelHeader } from "../inspector";

type MediaPanelProps = {
  primaryImage: string;
  openFilePicker: () => void;
};

export function MediaPanel({ primaryImage, openFilePicker }: MediaPanelProps) {
  return (
    <>
      <PanelHeader title="Media" detail="Use property and brand-safe imagery." />
      <button className="studio-dropzone" type="button" onClick={openFilePicker}>
        <ImageIcon aria-hidden size={22} />
        <span>Replace image</span>
        <small>PNG or JPG</small>
      </button>
      <div className="studio-media-grid">
        {MEDIA_ASSETS.map((asset) => (
          <button className={primaryImage === asset.src ? "active" : ""} key={asset.src} type="button">
            <img src={asset.src} alt="" />
            <span>{asset.label}</span>
            <small>{asset.type} / {asset.ratio}</small>
          </button>
        ))}
      </div>
    </>
  );
}
