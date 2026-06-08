"use client";

import { BadgeCheck, Globe2, Home, ImagePlus, LayoutGrid, MapPin, Target, Wand } from "lucide-react";

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

// Goal drives the offer: pick a goal and the offer list narrows to what fits it,
// defaulting to the primary offer for that goal. Keeps the two fields in sync.
const ALL_OFFERS = ["Free appraisal", "Market update", "Recent sales report", "Buyer demand check", "Home value estimate"];
const GOAL_OFFERS: Record<string, { offers: string[]; default: string }> = {
  "Get appraisal leads": { offers: ["Free appraisal", "Home value estimate"], default: "Free appraisal" },
  "Promote recent sale": { offers: ["Recent sales report", "Home value estimate"], default: "Recent sales report" },
  "Generate vendor leads": { offers: ["Free appraisal", "Home value estimate", "Recent sales report"], default: "Free appraisal" },
  "Promote open home": { offers: ["Buyer demand check", "Free appraisal"], default: "Buyer demand check" },
  "Drive market report downloads": { offers: ["Market update", "Recent sales report"], default: "Market update" },
  "Retarget warm audience": { offers: ["Free appraisal", "Buyer demand check", "Recent sales report"], default: "Free appraisal" },
};
const CAMPAIGN_GOALS = Object.keys(GOAL_OFFERS);

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
            <ImagePlus aria-hidden size={24} />
          </span>
          <strong>Create your first ad</strong>
          <p>
            Pick a template, add one photo, and Blockwise writes the copy and builds Story, Feed and Square — ready
            for Meta in about a minute.
          </p>
          <div className="studio-empty-row">
            <button className="studio-btn publish" type="button" onClick={onCreateAd}>
              <Wand aria-hidden size={16} />
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

  const goalConfig = GOAL_OFFERS[campaignGoal] ?? { offers: ALL_OFFERS, default: offerLabel };
  const goalOptions = CAMPAIGN_GOALS.includes(campaignGoal) ? CAMPAIGN_GOALS : [campaignGoal, ...CAMPAIGN_GOALS];
  const offerOptions = goalConfig.offers.includes(offerLabel) ? goalConfig.offers : [offerLabel, ...goalConfig.offers];

  function changeGoal(nextGoal: string) {
    setCampaignGoal(nextGoal);
    const config = GOAL_OFFERS[nextGoal];
    // Keep the offer in step with the goal unless the current offer already fits.
    if (config && !config.offers.includes(offerLabel)) setOfferLabel(config.default);
  }

  return (
    <>
      <PanelHeader title="Ad settings" detail="Goal and offer stay in sync — pick a goal and the offer follows." />
      <FieldShell label="Goal" icon={Target}>
        <select value={campaignGoal} onChange={(event) => changeGoal(event.target.value)}>
          {goalOptions.map((goal) => (
            <option key={goal}>{goal}</option>
          ))}
        </select>
      </FieldShell>
      <FieldShell label="Offer" icon={BadgeCheck}>
        <select value={offerLabel} onChange={(event) => setOfferLabel(event.target.value)}>
          {offerOptions.map((offer) => (
            <option key={offer}>{offer}</option>
          ))}
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
      <button className="studio-btn secondary block" type="button" onClick={onBrowseTemplates}>
        <LayoutGrid aria-hidden size={16} />
        Browse templates
      </button>
    </>
  );
}
