"use client";

import { BadgeCheck, Globe2, Home, MapPin, Pencil, Sparkles, Target, Wand2 } from "lucide-react";

import { FieldShell, PanelHeader } from "../inspector";

type CampaignPanelProps = {
  campaignGoal: string;
  setCampaignGoal: (value: string) => void;
  offerLabel: string;
  setOfferLabel: (value: string) => void;
  market: string;
  setMarket: (value: string) => void;
  propertyType: string;
  setPropertyType: (value: string) => void;
  leadDestination: string;
  setLeadDestination: (value: string) => void;
  destinationUrl: string;
  setDestinationUrl: (value: string) => void;
  variantCount: number;
  onCreateAd: () => void;
};

export function CampaignPanel({
  campaignGoal,
  setCampaignGoal,
  offerLabel,
  setOfferLabel,
  market,
  setMarket,
  propertyType,
  setPropertyType,
  leadDestination,
  setLeadDestination,
  destinationUrl,
  setDestinationUrl,
  variantCount,
  onCreateAd,
}: CampaignPanelProps) {
  if (variantCount === 0) {
    return (
      <>
        <PanelHeader title="Create ad" detail="Start with one image and a short description." />
        <div style={{ border: "1.5px dashed var(--line)", borderRadius: 8, padding: "22px 16px", textAlign: "center", display: "grid", gap: 12 }}>
          <Sparkles aria-hidden size={24} style={{ margin: "0 auto", color: "var(--muted)" }} />
          <strong style={{ fontSize: 15 }}>Create your first ad</strong>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.45 }}>
            Upload one image, add a short description, and Blockwise will generate Story, Feed, and Square.
          </p>
          <button className="studio-btn publish block" type="button" onClick={onCreateAd}>
            <Wand2 aria-hidden size={17} />
            Create ad
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <PanelHeader title="Ad settings" detail="Review the defaults before export or launch." />
      <FieldShell label="Goal" icon={Target}>
        <select value={campaignGoal} onChange={(event) => setCampaignGoal(event.target.value)}>
          <option>Get appraisal leads</option>
          <option>Promote recent sale</option>
          <option>Generate vendor leads</option>
          <option>Promote open home</option>
          <option>Drive market report downloads</option>
          <option>Retarget warm audience</option>
        </select>
      </FieldShell>
      <FieldShell label="Offer" icon={BadgeCheck}>
        <select value={offerLabel} onChange={(event) => setOfferLabel(event.target.value)}>
          <option>Free appraisal</option>
          <option>Market update</option>
          <option>Recent sales report</option>
          <option>Buyer demand check</option>
          <option>Home value estimate</option>
        </select>
      </FieldShell>
      <FieldShell label="Market / Location" icon={MapPin}>
        <input value={market} onChange={(event) => setMarket(event.target.value)} />
      </FieldShell>
      <FieldShell label="Property type" icon={Home}>
        <select value={propertyType} onChange={(event) => setPropertyType(event.target.value)}>
          <option>Houses</option>
          <option>Apartments</option>
          <option>Townhouses</option>
          <option>Land</option>
        </select>
      </FieldShell>
      <FieldShell label="Lead destination" icon={Globe2}>
        <select value={leadDestination} onChange={(event) => setLeadDestination(event.target.value)}>
          <option>Landing page</option>
          <option>Meta lead form</option>
          <option>CRM endpoint</option>
        </select>
      </FieldShell>
      <FieldShell label="Destination URL">
        <input value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} />
      </FieldShell>
      <button className="studio-link-btn" type="button">
        <Pencil aria-hidden size={16} />
        Edit ad details
      </button>
    </>
  );
}
