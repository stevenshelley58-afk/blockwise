"use client";

import { Trash2, X } from "lucide-react";

/**
 * Modal for confirming a destructive campaign action. Used by the publish
 * panel's "Delete campaign" button. Replaces the inline-styled modal that
 * previously lived at the bottom of the workbench.
 */
export function DeleteCampaignDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="studio-confirm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="studio-confirm-card">
        <header>
          <Trash2 aria-hidden size={18} />
          <h2 id="confirm-delete-title">Delete campaign?</h2>
          <button
            className="studio-icon-btn"
            type="button"
            aria-label="Close delete confirmation"
            onClick={onCancel}
          >
            <X aria-hidden size={16} />
          </button>
        </header>
        <p>This cannot be undone. The creatives and draft will be removed from your workspace.</p>
        <div className="studio-confirm-actions">
          <button className="studio-btn secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="studio-btn danger"
            type="button"
            onClick={onConfirm}
            data-action="confirm-delete"
          >
            <Trash2 aria-hidden size={15} />
            Delete campaign
          </button>
        </div>
      </div>
    </div>
  );
}
