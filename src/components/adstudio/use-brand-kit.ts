"use client";

import { useState } from "react";

import type { AdStudioBrandKit } from "@/lib/adstudio";

function hostOf(url: string): string {
  try {
    const host = new URL(url).host.replace(/^www\./, "");
    return host.endsWith(".example") ? "" : host;
  } catch {
    return "";
  }
}

/** Format a bare 10-digit AU number as (0X) XXXX XXXX, otherwise pass through. */
function formatAuPhone(raw: string | null): string {
  if (!raw) return "(08) 9999 0000";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)} ${digits.slice(6)}`;
  }
  return raw;
}

export function useBrandKit(brandKit: AdStudioBrandKit) {
  // Derived read-only values
  const brand = brandKit.identity.businessName || "Your agency";
  const initials = brand.charAt(0).toUpperCase();
  const domain = hostOf(brandKit.source.url);

  // Editable field state — initialised from prop
  const [editedBrand, setEditedBrand] = useState(brand);
  const [editedAgent, setEditedAgent] = useState(
    brandKit.identity.tradingName ?? "",
  );
  const [editedPhone, setEditedPhone] = useState(
    formatAuPhone(brandKit.contact.phone),
  );

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConfirmed, setSaveConfirmed] = useState(false);

  const kitId = brandKit.brandKitId;

  async function saveKit() {
    setIsSaving(true);
    setSaveError(null);
    setSaveConfirmed(false);
    try {
      const res = await fetch(`/api/adstudio/brand-kits/${kitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity_json: {
            ...brandKit.identity,
            businessName: editedBrand,
            tradingName: editedAgent,
          },
          contact_json: {
            ...brandKit.contact,
            phone: editedPhone,
          },
          business_name: editedBrand,
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(json.error ?? `Save failed (${res.status})`);
      } else {
        setSaveConfirmed(true);
        setTimeout(() => setSaveConfirmed(false), 2500);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Network error");
    } finally {
      setIsSaving(false);
    }
  }

  async function rescanKit() {
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/adstudio/brand-kits/${kitId}/rescan`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(json.error ?? `Rescan failed (${res.status})`);
      } else {
        const json = (await res.json().catch(() => ({}))) as {
          brandKit?: { identity?: { businessName?: string; tradingName?: string }; contact?: { phone?: string } };
        };
        if (json.brandKit?.identity?.businessName) {
          setEditedBrand(json.brandKit.identity.businessName);
        }
        if (json.brandKit?.identity?.tradingName) {
          setEditedAgent(json.brandKit.identity.tradingName);
        }
        if (json.brandKit?.contact?.phone) {
          setEditedPhone(formatAuPhone(json.brandKit.contact.phone));
        }
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Network error");
    } finally {
      setIsSaving(false);
    }
  }

  async function approveKit() {
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/adstudio/brand-kits/${kitId}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(json.error ?? `Approve failed (${res.status})`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Network error");
    } finally {
      setIsSaving(false);
    }
  }

  return {
    // Read-only derived values (used by AdPreview and workbench)
    brand,
    initials,
    domain,
    // Editable state
    editedBrand,
    setEditedBrand,
    editedAgent,
    setEditedAgent,
    editedPhone,
    setEditedPhone,
    // Action state
    isSaving,
    saveError,
    saveConfirmed,
    // Actions
    saveKit,
    rescanKit,
    approveKit,
  };
}
