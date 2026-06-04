"use client";

import { UsersRound } from "lucide-react";

import { FieldShell, PanelHeader } from "../inspector";

export function AudiencePanel() {
  return (
    <>
      <PanelHeader title="Audience" detail="Keep targeting guidance plain and safe." />
      <FieldShell label="Saved audience">
        <select defaultValue="seller">
          <option value="seller">South Perth homeowners</option>
          <option value="warm">Warm website visitors</option>
          <option value="open">Open-home visitors</option>
        </select>
      </FieldShell>
      <div className="studio-note-card">
        <UsersRound aria-hidden size={18} />
        Housing ads stay broad. Avoid sensitive personal attributes.
      </div>
    </>
  );
}
