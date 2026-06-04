"use client";

import { Settings2 } from "lucide-react";

import { PanelHeader } from "../inspector";

export function SettingsPanel() {
  return (
    <>
      <PanelHeader title="Settings" detail="Workspace defaults and permissions." />
      <div className="studio-note-card">
        <Settings2 aria-hidden size={18} />
        Account, permissions, and defaults remain managed by workspace settings.
      </div>
      <details className="studio-advanced">
        <summary>Advanced</summary>
        <p>Duplicate, export, archive, share, and reset actions live in the More menu.</p>
      </details>
    </>
  );
}
