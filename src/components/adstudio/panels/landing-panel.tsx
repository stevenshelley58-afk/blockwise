"use client";

import { Globe2 } from "lucide-react";

import { FieldShell, PanelHeader } from "../inspector";

type LandingPanelProps = {
  destinationUrl: string;
  setDestinationUrl: (value: string) => void;
};

export function LandingPanel({ destinationUrl, setDestinationUrl }: LandingPanelProps) {
  return (
    <>
      <PanelHeader title="Landing" detail="Send leads to one clear destination." />
      <FieldShell label="Destination URL">
        <input value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} />
      </FieldShell>
      <FieldShell label="Lead destination">
        <a className="studio-btn secondary block" href="/settings#connections">
          {"Manage in Settings -> Connections"}
        </a>
      </FieldShell>
      {/* H9: open destinationUrl in new tab */}
      <button
        className="studio-btn secondary block"
        type="button"
        disabled={!destinationUrl}
        onClick={() => window.open(destinationUrl, "_blank", "noopener")}
      >
        <Globe2 aria-hidden size={17} />
        Test landing page
      </button>
    </>
  );
}
