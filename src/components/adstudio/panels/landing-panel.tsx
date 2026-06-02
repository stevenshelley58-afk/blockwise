"use client";

import { Globe2 } from "lucide-react";

import { FieldShell, PanelHeader } from "../inspector";

type LandingPanelProps = {
  destinationUrl: string;
  setDestinationUrl: (value: string) => void;
  leadDestination: string;
  setLeadDestination: (value: string) => void;
};

export function LandingPanel({ destinationUrl, setDestinationUrl, leadDestination, setLeadDestination }: LandingPanelProps) {
  return (
    <>
      <PanelHeader title="Landing" detail="Send leads to one clear destination." />
      <FieldShell label="Destination URL">
        <input value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} />
      </FieldShell>
      <FieldShell label="Lead destination">
        <select value={leadDestination} onChange={(event) => setLeadDestination(event.target.value)}>
          <option>Landing page</option>
          <option>Meta lead form</option>
          <option>CRM endpoint</option>
        </select>
      </FieldShell>
      <button className="studio-btn secondary block" type="button">
        <Globe2 aria-hidden size={17} />
        Test landing page
      </button>
    </>
  );
}
