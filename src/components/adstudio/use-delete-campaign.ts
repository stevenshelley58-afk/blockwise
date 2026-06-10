"use client";

import { useCallback, useState } from "react";

/**
 * Owns the delete-campaign confirmation flow. Returns a stable handler that
 * opens the dialog, plus the `confirmDelete` action that hits the API and
 * routes away on success.
 */
export function useDeleteCampaign({
  campaignId,
  onDeleted,
  onError,
}: {
  campaignId: string;
  onDeleted?: () => void;
  onError?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const requestDelete = useCallback(() => setOpen(true), []);
  const cancelDelete = useCallback(() => setOpen(false), []);

  const confirmDelete = useCallback(async () => {
    setOpen(false);
    try {
      const res = await fetch(`/api/adstudio/campaigns/${campaignId}`, { method: "DELETE" });
      if (res.ok) {
        onDeleted?.();
      } else {
        onError?.("Could not delete campaign");
      }
    } catch {
      onError?.("Could not delete campaign");
    }
  }, [campaignId, onDeleted, onError]);

  return { open, requestDelete, cancelDelete, confirmDelete };
}
