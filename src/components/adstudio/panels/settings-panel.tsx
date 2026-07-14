"use client";

import { Home, MapPin, Settings2 } from "lucide-react";

import { FieldShell, PanelHeader } from "../inspector";

type SettingsPanelProps = {
  market: string;
  propertyType: string;
  onChangeMarket: (value: string) => void;
  onChangePropertyType: (value: string) => void;
};

const PROPERTY_TYPES = ["Houses", "Apartments", "Townhouses", "Land", "Rural", "Commercial"];

export function SettingsPanel({ market, propertyType, onChangeMarket, onChangePropertyType }: SettingsPanelProps) {
  return (
    <>
      <PanelHeader title="Settings" detail="Campaign defaults used when writing and targeting your ads." />
      <FieldShell label="Market (suburb, state)" icon={MapPin}>
        <input
          type="text"
          value={market}
          placeholder="South Perth, WA"
          onChange={(event) => onChangeMarket(event.target.value)}
        />
      </FieldShell>
      <FieldShell label="Property type" icon={Home}>
        <select value={propertyType} onChange={(event) => onChangePropertyType(event.target.value)}>
          {PROPERTY_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </FieldShell>
      <div className="studio-note-card">
        <Settings2 aria-hidden size={18} />
        Account, permissions, and defaults remain managed by workspace settings.
      </div>
      <details className="studio-advanced">
        <summary>More actions</summary>
        <p>Export, archive, share, and reset actions live in the More menu.</p>
      </details>
    </>
  );
}
