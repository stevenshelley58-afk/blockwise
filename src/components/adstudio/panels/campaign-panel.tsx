"use client";

import { BadgeCheck, Globe2, Home, MapPin, Sparkles, Target, Wand2 } from "lucide-react";

import type { AdStudioTemplate } from "@/lib/adstudio";

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
  onBrowseTemplates: () => void;
  templates: AdStudioTemplate[];
};

const EMPTY_STATE_GRADIENTS = ["studio-tpl-g0", "studio-tpl-g2", "studio-tpl-g4", "studio-tpl-g5"];

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
  onBrowseTemplates,
  templates,
}: CampaignPanelProps) {
  if (variantCount === 0) {
    const featured = templates.slice(0, 4);
    return (
      <>
        <PanelHeader title="Create ad" detail="Template + one photo = a finished ad." />
        <div className="studio-empty">
          <span className="studio-empty-ic">
            <Sparkles aria-hidden size={24} />
          </span>
          <strong>Create your first ad</strong>
          <p>
            Pick a template, add one photo, and Blockwise writes the copy and builds Story, Feed and Square — ready
            for Meta in about a minute.
          </p>
          <div className="studio-empty-row">
            <button className="studio-btn publish" type="button" onClick={onCreateAd}>
              <Wand2 aria-hidden size={16} />
              Create ad
            </button>
            <button className="studio-btn secondary" type="button" onClick={onBrowseTemplates}>
              Browse templates
            </button>
          </div>
          <div className="studio-mini-tpls" aria-label="Featured templates">
            {featured.map((template, index) => (
              <button
                key={template.id}
                type="button"
                className={EMPTY_STATE_GRADIENTS[index % EMPTY_STATE_GRADIENTS.length]}
                onClick={onCreateAd}
              >
                <span>{template.name}</span>
              </button>
            ))}
          </div>
          <small>{templates.length} templates tuned for WA real-estate compliance</small>
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
    </>
  );
}
