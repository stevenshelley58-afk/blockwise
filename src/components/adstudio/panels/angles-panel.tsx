"use client";

import { Wand2 } from "lucide-react";

import { MEDIA_ASSETS } from "../use-media";
import type { AngleCard } from "../angles";
import { PanelHeader } from "../inspector";

type AnglesPanelProps = {
  angles: AngleCard[];
  selectedAngleId: string;
  onGenerate: (angle: AngleCard) => void;
};

export function AnglesPanel({ angles, selectedAngleId, onGenerate }: AnglesPanelProps) {
  return (
    <>
      <PanelHeader title="Angles" detail="Choose the marketing angle before variants are generated." />
      <div className="studio-angle-list">
        {angles.map((angle, index) => (
          <button
            className={selectedAngleId === angle.id ? "studio-angle-card active" : "studio-angle-card"}
            key={angle.id}
            type="button"
            onClick={() => onGenerate(angle)}
          >
            <span className="studio-angle-thumb" style={{ backgroundImage: `url(${MEDIA_ASSETS[index % MEDIA_ASSETS.length].src})` }} />
            <span>
              <strong>{angle.name}</strong>
              <small>{angle.purpose}</small>
              <em>Best for: {angle.bestFor}</em>
            </span>
          </button>
        ))}
      </div>
      <button className="studio-btn publish block" type="button" onClick={() => onGenerate(angles.find((angle) => angle.id === selectedAngleId) ?? angles[0])}>
        <Wand2 aria-hidden size={17} />
        Generate variants
      </button>
    </>
  );
}
