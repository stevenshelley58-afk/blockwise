"use client";

import { Play, Save } from "lucide-react";
import { useMemo, useState } from "react";

import { StatusPill } from "@/components/status-pill";
import type {
  ModelCatalogOption,
  ModelControlProfileRow,
  ModelControlSection,
  ModelControlViewData,
} from "@/lib/model-control/model-control-config";

type ModelControlPanelProps = {
  initialData: ModelControlViewData;
};

type RowStatus = {
  tone: "green" | "amber" | "rose" | "blue";
  message: string;
};

type ActiveCandidate = ModelControlProfileRow["active"];

export function ModelControlPanel({ initialData }: ModelControlPanelProps) {
  const [sections, setSections] = useState<ModelControlSection[]>(initialData.sections);
  const [selectedByProfile, setSelectedByProfile] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialData.sections.flatMap((section) =>
        section.profiles.map((profile) => [profile.key, encodeOption(profile.active.provider, profile.active.model)]),
      ),
    ),
  );
  const [pendingByProfile, setPendingByProfile] = useState<Record<string, boolean>>({});
  const [statusByProfile, setStatusByProfile] = useState<Record<string, RowStatus>>({});

  const readiness = initialData.readiness.openrouter;
  const profileCount = useMemo(
    () => new Set(sections.flatMap((section) => section.profiles.map((profile) => profile.key))).size,
    [sections],
  );

  async function saveProfile(profile: ModelControlProfileRow) {
    const option = getSelectedOption(profile, selectedByProfile[profile.key]);

    if (!option || option.provider !== "openrouter") {
      setStatusByProfile((current) => ({
        ...current,
        [profile.key]: {
          tone: "amber",
          message: "Choose an OpenRouter model before saving.",
        },
      }));
      return;
    }

    setPendingByProfile((current) => ({ ...current, [profile.key]: true }));

    try {
      const response = await fetch(`/api/model-profiles/${profile.key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: option.provider, model: option.model }),
      });
      const payload = (await response.json()) as { active?: ActiveCandidate; error?: string };

      if (!response.ok || !payload.active) {
        throw new Error(payload.error ?? "Unable to save model profile.");
      }

      const active = payload.active;
      setSections((current) => updateProfileActiveCandidate(current, profile.key, active));
      setStatusByProfile((current) => ({
        ...current,
        [profile.key]: {
          tone: "green",
          message: "Saved",
        },
      }));
    } catch (error) {
      setStatusByProfile((current) => ({
        ...current,
        [profile.key]: {
          tone: "rose",
          message: error instanceof Error ? error.message : "Unable to save model profile.",
        },
      }));
    } finally {
      setPendingByProfile((current) => ({ ...current, [profile.key]: false }));
    }
  }

  async function testProfile(profile: ModelControlProfileRow) {
    const option = getSelectedOption(profile, selectedByProfile[profile.key]);

    if (!option || option.provider !== "openrouter") {
      setStatusByProfile((current) => ({
        ...current,
        [profile.key]: {
          tone: "amber",
          message: "Choose an OpenRouter model before testing.",
        },
      }));
      return;
    }

    setPendingByProfile((current) => ({ ...current, [profile.key]: true }));

    try {
      const response = await fetch(`/api/model-profiles/${profile.key}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: option.provider, model: option.model }),
      });
      const payload = (await response.json()) as { content?: string; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "OpenRouter test failed.");
      }

      setStatusByProfile((current) => ({
        ...current,
        [profile.key]: {
          tone: "green",
          message: `Test returned ${payload.content || "empty output"}`,
        },
      }));
    } catch (error) {
      setStatusByProfile((current) => ({
        ...current,
        [profile.key]: {
          tone: "rose",
          message: error instanceof Error ? error.message : "OpenRouter test failed.",
        },
      }));
    } finally {
      setPendingByProfile((current) => ({ ...current, [profile.key]: false }));
    }
  }

  return (
    <div className="stack">
      <section className="panel model-readiness">
        <div>
          <h2>OpenRouter</h2>
          <p className="item-meta">
            {readiness.configured
              ? "OpenRouter API key is configured for server-side model tests and routing."
              : `Missing ${readiness.missing.join(", ")}. Dropdowns still render, but live tests and saved OpenRouter runs need the key.`}
          </p>
        </div>
        <StatusPill tone={readiness.configured ? "green" : "amber"}>
          {readiness.configured ? "Ready" : "Key missing"}
        </StatusPill>
      </section>

      <section className="grid cols-3">
        <article className="item-card">
          <h3>{profileCount}</h3>
          <p className="item-meta">Runtime profiles with selectable primary models.</p>
        </article>
        <article className="item-card">
          <h3>OpenRouter</h3>
          <p className="item-meta">Curated model slugs are stored without legacy prefixes.</p>
        </article>
        <article className="item-card">
          <h3>Fallbacks</h3>
          <p className="item-meta">Fallback chains are shown for review and left unchanged.</p>
        </article>
      </section>

      {sections.map((section) => (
        <section className="panel model-section" key={section.key}>
          <div className="section-heading">
            <div>
              <h2>{section.label}</h2>
              <p className="item-meta">{section.description}</p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table model-table">
              <thead>
                <tr>
                  <th>Profile</th>
                  <th>Primary model</th>
                  <th>Cost and context</th>
                  <th>Fallbacks</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {section.profiles.map((profile) => {
                  const selected = selectedByProfile[profile.key];
                  const option = getSelectedOption(profile, selected);
                  const changed = selected !== encodeOption(profile.active.provider, profile.active.model);
                  const pending = Boolean(pendingByProfile[profile.key]);
                  const rowStatus = statusByProfile[profile.key];

                  return (
                    <tr key={profile.key}>
                      <td>
                        <strong>{profile.label}</strong>
                        <p className="item-meta">{profile.task}</p>
                      </td>
                      <td>
                        <label className="sr-only" htmlFor={`${profile.key}-model`}>
                          Primary model for {profile.label}
                        </label>
                        <select
                          className="model-select"
                          id={`${profile.key}-model`}
                          value={selected}
                          onChange={(event) =>
                            setSelectedByProfile((current) => ({
                              ...current,
                              [profile.key]: event.target.value,
                            }))
                          }
                        >
                          {profile.options.map((candidate) => (
                            <option value={encodeOption(candidate.provider, candidate.model)} key={`${candidate.provider}:${candidate.model}`}>
                              {candidate.label}
                            </option>
                          ))}
                        </select>
                        <p className="item-meta">
                          {option?.provider ?? profile.active.provider} / {option?.model ?? profile.active.model}
                        </p>
                      </td>
                      <td>
                        <div className="model-meta-grid">
                          <span>${formatCost(option?.inputUsdPerMillionTokens ?? profile.active.inputUsdPerMillionTokens)} in</span>
                          <span>${formatCost(option?.outputUsdPerMillionTokens ?? profile.active.outputUsdPerMillionTokens)} out</span>
                          <span>{formatTokens(option?.maxContextTokens ?? profile.active.maxContextTokens)} ctx</span>
                        </div>
                      </td>
                      <td>
                        <span>{profile.fallbacks.length}</span>
                        <p className="item-meta">{profile.fallbacks.map((fallback) => fallback.model).join(", ") || "None"}</p>
                      </td>
                      <td>
                        <StatusPill tone={profile.enabled ? "green" : "rose"}>{profile.enabled ? "Enabled" : "Disabled"}</StatusPill>
                        {rowStatus ? (
                          <p className={`row-status ${rowStatus.tone}`}>{rowStatus.message}</p>
                        ) : null}
                      </td>
                      <td>
                        <div className="actions model-actions">
                          <button
                            className="icon-button"
                            type="button"
                            aria-label={`Save ${profile.label} model`}
                            title="Save model"
                            disabled={!changed || pending || option?.provider !== "openrouter"}
                            onClick={() => saveProfile(profile)}
                          >
                            <Save aria-hidden size={18} />
                          </button>
                          <button
                            className="icon-button"
                            type="button"
                            aria-label={`Test ${profile.label} model`}
                            title="Test model"
                            disabled={pending || option?.provider !== "openrouter"}
                            onClick={() => testProfile(profile)}
                          >
                            <Play aria-hidden size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function encodeOption(provider: string, model: string) {
  return `${provider}|${model}`;
}

function getSelectedOption(profile: ModelControlProfileRow, value?: string): ModelCatalogOption | undefined {
  return profile.options.find((option) => encodeOption(option.provider, option.model) === value);
}

function updateProfileActiveCandidate(
  sections: ModelControlSection[],
  profileKey: string,
  active: ActiveCandidate,
): ModelControlSection[] {
  return sections.map((section) => ({
    ...section,
    profiles: section.profiles.map((profile) =>
      profile.key === profileKey
        ? {
            ...profile,
            active,
          }
        : profile,
    ),
  }));
}

function formatCost(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 3,
  });
}

function formatTokens(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  return String(value);
}
