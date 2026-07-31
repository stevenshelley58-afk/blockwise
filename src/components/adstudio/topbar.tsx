"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Archive, Cloud, MoreHorizontal, Palette, Settings2, Share2, Trash2 } from "lucide-react";

import { BlockwiseLogo } from "@/components/blockwise-logo";

type TopBarProps = {
  campaignId?: string;
  campaignName: string;
  minimal?: boolean;
  showMore: boolean;
  setShowMore: (value: boolean | ((prev: boolean) => boolean)) => void;
  onSave: () => void | Promise<unknown>;
  onDelete?: () => void;
  onOpenBrand?: () => void;
  onOpenSettings?: () => void;
  showToast?: (message: string) => void;
};

export function TopBar({
  campaignId = "",
  campaignName,
  minimal = false,
  showMore,
  setShowMore,
  onSave,
  onDelete,
  onOpenBrand,
  onOpenSettings,
  showToast = () => {},
}: TopBarProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name?: string; status?: string }>>([]);

  useEffect(() => {
    if (!showMore) return;
    function handleClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMore(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMore, setShowMore]);

  useEffect(() => {
    const loadCampaigns = () => {
      fetch("/api/adstudio/campaigns?limit=50", { cache: "no-store" })
        .then((response) => response.json().catch(() => null))
        .then((payload) => {
          if (!Array.isArray(payload?.campaigns)) return;
          setCampaigns(
            payload.campaigns
              .filter((campaign: { id?: unknown; status?: unknown }) => typeof campaign.id === "string" && campaign.status !== "archived")
              .map((campaign: { id: string; name?: unknown; status?: unknown }) => ({
                id: campaign.id,
                name: typeof campaign.name === "string" ? campaign.name : "Campaign",
                status: typeof campaign.status === "string" ? campaign.status : undefined,
              })),
          );
        })
        .catch(() => {});
    };
    const browser = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (browser.requestIdleCallback) {
      const id = browser.requestIdleCallback(loadCampaigns, { timeout: 2_000 });
      return () => browser.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(loadCampaigns, 1_000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!showMore) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setShowMore(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [showMore, setShowMore]);

  async function flushDraft() {
    await onSave();
  }

  function handleSaveFromMenu() {
    setShowMore(false);
    onSave();
  }

  async function handleShare() {
    setShowMore(false);
    try {
      await flushDraft();
      const url = new URL(window.location.href);
      if (campaignId) url.searchParams.set("campaignId", campaignId);
      await navigator.clipboard.writeText(url.toString());
      showToast("Link copied to clipboard");
    } catch {
      showToast("Could not copy link");
    }
  }

  async function handleArchive() {
    setShowMore(false);
    try {
      await flushDraft();
      const res = await fetch(`/api/adstudio/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (!res.ok) throw new Error("Failed");
      showToast("Ad archived");
      window.location.href = "/ad-studio";
    } catch {
      showToast("Could not archive campaign");
    }
  }

  return (
    <header className="studio-topbar">
      <div className="studio-titlebar">
        <Link className="studio-home-link" href="/self-serve" aria-label="Go to Blockwise home">
          <BlockwiseLogo />
        </Link>
        {!minimal && <span className="studio-divider" />}
        {!minimal && <span className="studio-breadcrumb">Ad Studio / {campaignName}</span>}
        {!minimal && campaigns.length > 1 && (
          <select
            className="studio-campaign-select"
            aria-label="Switch campaign"
            value={campaignId}
            onChange={(event) => {
              const nextCampaignId = event.target.value;
              if (!nextCampaignId) return;
              void flushDraft().then(() => {
                window.location.href = `/ad-studio?campaignId=${encodeURIComponent(nextCampaignId)}`;
              });
            }}
          >
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name ?? "Campaign"}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="studio-mobile-title">
        <Link className="studio-home-link" href="/self-serve" aria-label="Go to Blockwise home">
          <BlockwiseLogo />
        </Link>
        <span className="studio-divider" />
        <strong>Ad Studio</strong>
      </div>
      <div className="studio-actions">
        <button className="studio-btn secondary" type="button" onClick={onSave}>
          <Cloud aria-hidden size={17} />
          Save
        </button>
        <button
          className="studio-icon-btn"
          type="button"
          aria-label="More actions"
          aria-expanded={showMore}
          aria-haspopup="menu"
          onClick={() => setShowMore((value) => !value)}
        >
          <MoreHorizontal aria-hidden size={20} />
        </button>
      </div>

      {showMore && (
        <div className="studio-more-menu" ref={menuRef} role="menu" aria-label="Ad actions">
          <button className="studio-mobile-menu-save" type="button" role="menuitem" onClick={handleSaveFromMenu}>
            <Cloud aria-hidden size={16} />
            Save draft
          </button>
          <button type="button" role="menuitem" onClick={handleShare}>
            <Share2 aria-hidden size={16} />
            Copy link
          </button>
          {onOpenBrand && (
            <button
              className="studio-mobile-menu-brand"
              type="button"
              role="menuitem"
              onClick={() => {
                setShowMore(false);
                onOpenBrand();
              }}
            >
              <Palette aria-hidden size={16} />
              Brand Pack
            </button>
          )}
          {onOpenSettings && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setShowMore(false);
                onOpenSettings();
              }}
            >
              <Settings2 aria-hidden size={16} />
              Campaign settings
            </button>
          )}
          {onDelete && campaignId && <span className="studio-menu-line" />}
          {onDelete && campaignId && (
            <button type="button" role="menuitem" onClick={handleArchive}>
              <Archive aria-hidden size={16} />
              Archive campaign
            </button>
          )}
          {onDelete && campaignId && (
            <button
              className="danger"
              type="button"
              role="menuitem"
              onClick={() => {
                setShowMore(false);
                onDelete();
              }}
            >
              <Trash2 aria-hidden size={16} />
              Delete campaign
            </button>
          )}
        </div>
      )}
    </header>
  );
}
