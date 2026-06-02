"use client";

import {
  Archive,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  Download,
  MoreHorizontal,
  Send,
  Share2,
  Smartphone,
  Trash2,
} from "lucide-react";

import { BlockwiseLogo } from "@/components/blockwise-logo";

type TopBarProps = {
  campaignName: string;
  showMore: boolean;
  setShowMore: (value: boolean | ((prev: boolean) => boolean)) => void;
  onPreview: () => void;
  onSave: () => void;
  onPublish: () => void;
  onExport: () => void;
};

export function TopBar({ campaignName, showMore, setShowMore, onPreview, onSave, onPublish, onExport }: TopBarProps) {
  return (
    <header className="studio-topbar">
      <div className="studio-titlebar">
        <BlockwiseLogo />
        <span className="studio-divider" />
        <span className="studio-breadcrumb">Ad Studio / {campaignName}</span>
        <ChevronDown aria-hidden size={16} />
      </div>
      <div className="studio-mobile-title">
        <BlockwiseLogo />
        <span className="studio-divider" />
        <strong>Ad Studio</strong>
      </div>
      <div className="studio-actions">
        <button className="studio-btn secondary" type="button" onClick={onPreview}>
          <Smartphone aria-hidden size={17} />
          Preview
        </button>
        <button className="studio-btn secondary" type="button" onClick={onSave}>
          <Cloud aria-hidden size={17} />
          Save
        </button>
        <button className="studio-btn publish" type="button" onClick={onPublish}>
          <Send aria-hidden size={17} />
          Publish
        </button>
        <button className="studio-icon-btn" type="button" aria-label="More actions" onClick={() => setShowMore((value) => !value)}>
          <MoreHorizontal aria-hidden size={20} />
        </button>
      </div>

      {showMore && (
        <div className="studio-more-menu">
          <button type="button">
            <Copy aria-hidden size={16} />
            Duplicate campaign
          </button>
          <button type="button" onClick={onExport}>
            <Download aria-hidden size={16} />
            Export creatives
            <ChevronRight aria-hidden size={15} />
          </button>
          <button type="button">
            <Share2 aria-hidden size={16} />
            Share for review
          </button>
          <button type="button">
            <BadgeCheck aria-hidden size={16} />
            Send for approval
          </button>
          <span className="studio-menu-line" />
          <button type="button">
            <Archive aria-hidden size={16} />
            Archive campaign
          </button>
          <button className="danger" type="button">
            <Trash2 aria-hidden size={16} />
            Delete campaign
          </button>
        </div>
      )}
    </header>
  );
}
