"use client";

import { CopyFields, PanelHeader } from "../inspector";
import type { CopyState } from "../use-copy";

type CopyPanelProps = {
  copy: CopyState;
  updateCopy: (key: keyof CopyState, value: string) => void;
};

export function CopyPanel({ copy, updateCopy }: CopyPanelProps) {
  return (
    <>
      <PanelHeader title="Copy" detail="Edit message, not layout." />
      <CopyFields copy={copy} updateCopy={updateCopy} />
      <div className="studio-assist-row">
        {["Make sharper", "Make more local", "Make more premium", "Make more direct", "Reduce hype", "Generate 5 hooks"].map((label) => (
          <button key={label} type="button">
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
