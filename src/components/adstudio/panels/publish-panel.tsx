"use client";

import { FieldShell, PanelHeader } from "../inspector";

export function PublishSetupPanel() {
  return (
    <>
      <PanelHeader title="Publish" detail="Confirm the launch checklist before export." />
      <div className="studio-publish-list">
        {["Story", "Feed", "Square"].map((item) => (
          <label key={item}>
            <input type="checkbox" defaultChecked />
            {item}
          </label>
        ))}
      </div>
      <FieldShell label="Budget">
        <input defaultValue="Manual export" />
      </FieldShell>
      <FieldShell label="Schedule">
        <input defaultValue="Choose in ad account" />
      </FieldShell>
    </>
  );
}
