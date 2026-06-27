"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Archive, Cloud, Copy, MoreHorizontal, Share2, Trash2 } from "lucide-react";

import { BlockwiseLogo } from "@/components/blockwise-logo";

type TopBarProps = {
  campaignId?: string;
  campaignName: string;
  showMore: boolean;
  setShowMore: (value: boolean | ((prev: boolean) => boolean)) => void;
  onSave: () => void | Promise<unknown>;
  onDelete?: () => void;
  showToast?: (message: string) => void;
};

export function TopBar({
  campaignId = "",
  campaignName,
  showMore,
  setShowMore,
  onSave,
  onDelete,
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
    fetch("/api/adstudio/campaigns", { cache: "no-store" })
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

  async function handleDuplicate() {
    setShowMore(false);
    try {
      await flushDraft();
      const res = await fetch(`/api/adstudio/campaigns/${campaignId}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const json = (await res.json().catch(() => ({}))) as { duplicate?: { location?: string } };
      const location = res.headers.get("Location") ?? json.duplicate?.location;
      showToast("Ad duplicated");
      if (location) window.location.href = location;
    } catch {
      showToast("Could not duplicate campaign");
    }
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
        <span className="studio-divider" />
        <span className="studio-breadcrumb">Ad Studio / {campaignName}</span>
        {campaigns.length > 1 && (
          <select
            aria-label="Switch campaign"
            value={campaignId}
            onChange={(event) => {
              const nextCampaignId = event.target.value;
              if (!nextCampaignId) return;
              void flushDraft().then(() => {
                window.location.href = `/ad-studio?campaignId=${encodeURIComponent(nextCampaignId)}`;
              });
            }}
            style={{
              height: 32,
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "#fff",
              color: "var(--ink)",
              fontSize: 12.5,
              fontWeight: 650,
              padding: "0 8px",
              maxWidth: 220,
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
          <button type="button" role="menuitem" onClick={handleDuplicate}>
            <Copy aria-hidden size={16} />
            Duplicate campaign
          </button>
          <button type="button" role="menuitem" onClick={handleShare}>
            <Share2 aria-hidden size={16} />
            Copy link
          </button>
          <span className="studio-menu-line" />
          <button type="button" role="menuitem" onClick={handleArchive}>
            <Archive aria-hidden size={16} />
            Archive campaign
          </button>
          <button
            className="danger"
            type="button"
            role="menuitem"
            onClick={() => {
              setShowMore(false);
              onDelete?.();
            }}
          >
            <Trash2 aria-hidden size={16} />
            Delete campaign
          </button>
        </div>
      )}
    </header>
  );
}
