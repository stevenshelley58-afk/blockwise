"use client";

import type { LucideIcon } from "lucide-react";

import type { CopyState } from "./use-copy";
import { COPY_LIMITS } from "./use-copy";

export function PanelHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="studio-panel-header">
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

export function FieldShell({ label, icon: Icon, children }: { label: string; icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <label className="studio-field">
      <span>{label}</span>
      <div>
        {Icon ? <Icon aria-hidden size={17} /> : null}
        {children}
      </div>
    </label>
  );
}

type CopyFieldsProps = {
  copy: CopyState;
  updateCopy: (key: keyof CopyState, value: string) => void;
};

export function CopyFields({ copy, updateCopy }: CopyFieldsProps) {
  return (
    <div className="studio-copy-fields">
      {([
        ["primaryText", "Primary text"],
        ["headline", "Headline"],
        ["description", "Description"],
        ["cta", "CTA"],
      ] as Array<[keyof CopyState, string]>).map(([key, label]) => {
        const overLimit = copy[key].length > COPY_LIMITS[key];
        return (
          <label key={key}>
            <span>
              {label}
              <small style={{ color: overLimit ? "var(--red, #c00)" : undefined }}>
                {copy[key].length} / {COPY_LIMITS[key]}
              </small>
            </span>
            <textarea rows={key === "primaryText" ? 3 : 2} value={copy[key]} onChange={(event) => updateCopy(key, event.target.value)} />
            {overLimit && (
              <small style={{ color: "var(--red, #c00)" }}>
                Over the Meta limit - shorten this.
              </small>
            )}
          </label>
        );
      })}
    </div>
  );
}
