"use client";

import { BadgeCheck, Globe2, Home, MapPin, Pencil, Target, Wand2 } from "lucide-react";

import type { AngleCard } from "../angles";
import { FieldShell, PanelHeader } from "../inspector";

type CampaignPanelProps = {
  angles: AngleCard[];
  selectedAngleId: string;
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
  onGenerate: (angle: AngleCard) => void;
};

export function CampaignPanel({
  angles,
  selectedAngleId,
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
  onGenerate,
}: CampaignPanelProps) {
  return (
    <>
      <PanelHeader title="Campaign" detail="Set up the basics for your campaign." />
      <FieldShell label="Campaign goal" icon={Target}>
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
        Edit campaign brief
      </button>
      <button
        className="studio-btn publish block"
        type="button"
        onClick={() => onGenerate(angles.find((angle) => angle.id === selectedAngleId) ?? angles[0])}
      >
        <Wand2 aria-hidden size={17} />
        Generate variants
      </button>
    </>
  );
}
