"use client";

import { useState, type FormEvent } from "react";

import { Feedback, REGION_CURRENCY, REGION_NAMES, Section, type Msg, type RT, type SB, type SettingsViewProps } from "./settings-shared";

export function WorkspaceSection({ supabase, router, workspace }: { supabase: SB; router: RT; workspace: SettingsViewProps["workspace"] }) {
  const [name, setName] = useState(workspace.name);
  const [region, setRegion] = useState(workspace.region);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await supabase
      .from("workspaces")
      .update({
        name: name.trim() || workspace.name,
        region: region.trim() || "AU",
        updated_at: new Date().toISOString(),
      })
      .eq("id", workspace.id);
    setBusy(false);
    if (error) {
      setMessage({ tone: "error", text: "Couldn't save workspace settings." });
      return;
    }
    setMessage({ tone: "success", text: "Workspace settings saved." });
    router.refresh();
  }

  return (
    <Section id="workspace" title="Workspace" description="Settings for this workspace.">
      <form className="stack" onSubmit={save}>
        <label className="wizard-field">
          <span className="wizard-label">Workspace name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="wizard-field">
          <span className="wizard-label">Region</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)} required>
            {Object.keys(REGION_CURRENCY).map((r) => (
              <option key={r} value={r}>{REGION_NAMES[r] ?? r}</option>
            ))}
          </select>
        </label>
        <div className="wizard-connect-row">
          <span>
            <strong>Publishing review</strong>
            <div className="item-meta">All campaigns are reviewed before going live during early access.</div>
          </span>
        </div>
        <Feedback message={message} />
        <div className="wizard-actions">
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Saving" : "Save workspace"}
          </button>
        </div>
      </form>
    </Section>
  );
}
