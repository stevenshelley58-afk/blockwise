"use client";

import { RotateCcw, Save, Send, TestTube2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { StatusPill } from "@/components/status-pill";

type PromptSummary = {
  key: string;
  group: string;
  label: string;
  activeVersion: number | null;
  draftCount: number;
  archivedCount: number;
  updatedAt: string | null;
  fallbackActive: boolean;
  lastTestStatus: string | null;
};

type PromptVersion = {
  id: string | null;
  key: string;
  version: number;
  title: string;
  body: string;
  status: "draft" | "active" | "archived";
  source: "db" | "fallback";
  notes: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
};

type PromptFixture = {
  id: string;
  label: string;
  task: string;
  description: string;
};

type PromptRunRow = {
  id: string;
  provider_name: string | null;
  provider_type: string | null;
  model_name: string | null;
  task_type: string | null;
  model_profile: string | null;
  correlation_id: string | null;
  user_id: string | null;
  ai_run_id: string | null;
  ai_usage_ledger_id: string | null;
  input_json: Record<string, unknown>;
  usage_json: Record<string, unknown>;
  cost_estimate: number | string | null;
  status: string;
  error_json: Record<string, unknown> | null;
  created_at: string;
};

type PromptListResponse = {
  prompts: PromptSummary[];
  fixtures: PromptFixture[];
  recentRuns: PromptRunRow[];
};

type PromptDetailResponse = {
  key: string;
  active: PromptVersion;
  versions: PromptVersion[];
};

type PromptTestResponse = {
  assembledPrompt: {
    system: string;
    user: string;
    fullPrompt: string;
    warnings: string[];
    fallbackPromptUsed: boolean;
  };
  redactionPreview: Record<string, unknown>;
  fixture: PromptFixture;
  status: string;
  error?: string;
};

export function PromptControlPanel() {
  const [summaries, setSummaries] = useState<PromptSummary[]>([]);
  const [fixtures, setFixtures] = useState<PromptFixture[]>([]);
  const [recentRuns, setRecentRuns] = useState<PromptRunRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [detail, setDetail] = useState<PromptDetailResponse | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [selectedFixture, setSelectedFixture] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<number | "active">("active");
  const [testResult, setTestResult] = useState<PromptTestResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadPromptList();
  }, []);

  useEffect(() => {
    if (selectedKey) {
      void loadPromptDetail(selectedKey);
    }
  }, [selectedKey]);

  const grouped = useMemo(() => {
    return summaries.reduce<Record<string, PromptSummary[]>>((acc, summary) => {
      acc[summary.group] ??= [];
      acc[summary.group].push(summary);
      return acc;
    }, {});
  }, [summaries]);

  const draftVersions = detail?.versions.filter((version) => version.status === "draft") ?? [];
  const archivedVersions = detail?.versions.filter((version) => version.status === "archived") ?? [];
  const compareVersion = selectedVersion === "active"
    ? detail?.active
    : detail?.versions.find((version) => version.version === selectedVersion);
  const diffRows = buildLineDiff(compareVersion?.body ?? "", draftBody);

  async function loadPromptList() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/operator/prompts", { cache: "no-store" });
      const payload = (await response.json()) as PromptListResponse & { error?: string };

      if (!response.ok) throw new Error(payload.error ?? "Unable to load prompts.");

      setSummaries(payload.prompts);
      setFixtures(payload.fixtures);
      setRecentRuns(payload.recentRuns ?? []);
      setSelectedKey((current) => current || payload.prompts[0]?.key || "");
      setSelectedFixture((current) => current || payload.fixtures[0]?.id || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load prompts.");
    } finally {
      setPending(false);
    }
  }

  async function loadPromptDetail(key: string) {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/operator/prompts/${encodeURIComponent(key)}`, { cache: "no-store" });
      const payload = (await response.json()) as PromptDetailResponse & { error?: string };

      if (!response.ok) throw new Error(payload.error ?? "Unable to load prompt.");

      setDetail(payload);
      setDraftTitle(payload.active.title);
      setDraftBody(payload.active.body);
      setDraftNotes("");
      setSelectedVersion("active");
      setTestResult(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load prompt.");
    } finally {
      setPending(false);
    }
  }

  async function saveDraft() {
    if (!selectedKey) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/operator/prompts/${encodeURIComponent(selectedKey)}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: draftTitle,
          body: draftBody,
          notes: draftNotes,
          metadata: { saved_from: "model_control_prompts" },
        }),
      });
      const payload = (await response.json()) as { draft?: PromptVersion; error?: string };

      if (!response.ok || !payload.draft) throw new Error(payload.error ?? "Unable to save draft.");

      setMessage(`Draft v${payload.draft.version} saved.`);
      await loadPromptDetail(selectedKey);
      await loadPromptList();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save draft.");
    } finally {
      setPending(false);
    }
  }

  async function promote(version: number) {
    if (!selectedKey) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/operator/prompts/${encodeURIComponent(selectedKey)}/versions/${version}/promote`,
        { method: "POST" },
      );
      const payload = (await response.json()) as { active?: PromptVersion; error?: string };

      if (!response.ok || !payload.active) throw new Error(payload.error ?? "Unable to promote prompt.");

      setMessage(`Version ${payload.active.version} is active.`);
      await loadPromptDetail(selectedKey);
      await loadPromptList();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to promote prompt.");
    } finally {
      setPending(false);
    }
  }

  async function rollback(version: number) {
    if (!selectedKey) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/operator/prompts/${encodeURIComponent(selectedKey)}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetVersion: version }),
      });
      const payload = (await response.json()) as { active?: PromptVersion; error?: string };

      if (!response.ok || !payload.active) throw new Error(payload.error ?? "Unable to rollback prompt.");

      setMessage(`Rolled back via new active v${payload.active.version}.`);
      await loadPromptDetail(selectedKey);
      await loadPromptList();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to rollback prompt.");
    } finally {
      setPending(false);
    }
  }

  async function runTest() {
    if (!selectedKey || !selectedFixture) return;
    setPending(true);
    setMessage(null);
    try {
      const version = selectedVersion === "active" ? undefined : selectedVersion;
      const response = await fetch(`/api/operator/prompts/${encodeURIComponent(selectedKey)}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureId: selectedFixture, version }),
      });
      const payload = (await response.json()) as PromptTestResponse;

      if (!response.ok) throw new Error(payload.error ?? "Unable to run prompt test.");

      setTestResult(payload);
      setMessage(`Test assembled for ${payload.fixture.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to run prompt test.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel model-section">
      <div className="section-heading">
        <div>
          <h2>Prompts</h2>
          <p className="item-meta">Operator-only prompt policy. Customer users never see or edit these prompts.</p>
        </div>
        <StatusPill tone={pending ? "blue" : "green"}>{pending ? "Working" : "Ready"}</StatusPill>
      </div>

      {message ? <p className="row-status blue">{message}</p> : null}

      <div className="grid cols-3">
        <div className="item-card">
          <h3>{summaries.length}</h3>
          <p className="item-meta">Registered prompt sections.</p>
        </div>
        <div className="item-card">
          <h3>{summaries.filter((summary) => summary.fallbackActive).length}</h3>
          <p className="item-meta">Using bundled fallback.</p>
        </div>
        <div className="item-card">
          <h3>{summaries.reduce((sum, summary) => sum + summary.draftCount, 0)}</h3>
          <p className="item-meta">Draft versions waiting.</p>
        </div>
      </div>

      <div className="grid cols-3 prompt-control-grid">
        <aside className="prompt-key-list">
          {Object.entries(grouped).map(([group, prompts]) => (
            <div key={group}>
              <h3>{group}</h3>
              {prompts.map((prompt) => (
                <button
                  className={prompt.key === selectedKey ? "item-card active" : "item-card"}
                  key={prompt.key}
                  type="button"
                  onClick={() => setSelectedKey(prompt.key)}
                >
                  <strong>{prompt.label}</strong>
                  <span className="item-meta">{prompt.key}</span>
                  <span className="item-meta">
                    {prompt.activeVersion ? `Active v${prompt.activeVersion}` : "Fallback"}
                    {prompt.draftCount ? ` / ${prompt.draftCount} draft` : ""}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        <div className="prompt-editor">
          <label>
            <span>Title</span>
            <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
          </label>
          <label>
            <span>Prompt body</span>
            <textarea rows={18} value={draftBody} onChange={(event) => setDraftBody(event.target.value)} />
          </label>
          <label>
            <span>Notes</span>
            <textarea rows={4} value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} />
          </label>
          <div className="actions">
            <button className="button" type="button" disabled={pending || !draftBody.trim()} onClick={saveDraft}>
              <Save aria-hidden size={16} />
              Save draft
            </button>
          </div>
        </div>

        <div className="prompt-side">
          <section className="item-card">
            <h3>Active</h3>
            <p className="item-meta">
              {detail?.active.source === "fallback"
                ? "Bundled fallback is active because no DB prompt is active."
                : `Version ${detail?.active.version ?? "-"}`}
            </p>
            <pre className="prompt-preview">{detail?.active.body ?? ""}</pre>
          </section>

          <section className="item-card">
            <div className="section-heading compact">
              <h3>Test</h3>
              <StatusPill tone="blue">Assemble-only</StatusPill>
            </div>
            <select value={selectedFixture} onChange={(event) => setSelectedFixture(event.target.value)}>
              {fixtures.map((fixture) => (
                <option value={fixture.id} key={fixture.id}>
                  {fixture.label}
                </option>
              ))}
            </select>
            <select
              value={String(selectedVersion)}
              onChange={(event) => setSelectedVersion(event.target.value === "active" ? "active" : Number(event.target.value))}
            >
              <option value="active">Active</option>
              {detail?.versions.map((version) => (
                <option value={version.version} key={version.version}>
                  v{version.version} {version.status}
                </option>
              ))}
            </select>
            <button className="button" type="button" disabled={pending || !selectedFixture} onClick={runTest}>
              <TestTube2 aria-hidden size={16} />
              Run test
            </button>
          </section>
        </div>
      </div>

      <section className="panel nested-panel">
        <div className="section-heading">
          <h3>Diff</h3>
          <p className="item-meta">Comparison between selected version and editor draft.</p>
        </div>
        <pre className="prompt-diff">
          {diffRows.map((row, index) => (
            <span className={row.kind} key={`${row.kind}-${index}-${row.text}`}>
              {row.prefix} {row.text}
            </span>
          ))}
        </pre>
      </section>

      {draftVersions.length ? (
        <section className="panel nested-panel">
          <h3>Drafts</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Title</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {draftVersions.map((version) => (
                  <tr key={version.version}>
                    <td>v{version.version}</td>
                    <td>{version.title}</td>
                    <td>{formatDate(version.createdAt)}</td>
                    <td>
                      <button className="icon-button" type="button" title="Promote" onClick={() => promote(version.version)}>
                        <Send aria-hidden size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {archivedVersions.length ? (
        <section className="panel nested-panel">
          <h3>Rollback</h3>
          <div className="actions">
            {archivedVersions.slice(0, 6).map((version) => (
              <button className="button secondary" type="button" key={version.version} onClick={() => rollback(version.version)}>
                <RotateCcw aria-hidden size={16} />
                v{version.version}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {testResult ? (
        <section className="panel nested-panel">
          <div className="section-heading">
            <div>
              <h3>Test Result</h3>
              <p className="item-meta">{testResult.fixture.label}</p>
            </div>
            <StatusPill tone={testResult.assembledPrompt.fallbackPromptUsed ? "amber" : "green"}>
              {testResult.assembledPrompt.fallbackPromptUsed ? "Fallback" : "Assembled"}
            </StatusPill>
          </div>
          <div className="grid cols-2">
            <div>
              <h4>Assembled prompt</h4>
              <pre className="prompt-preview tall">{testResult.assembledPrompt.fullPrompt}</pre>
            </div>
            <div>
              <h4>Redaction preview</h4>
              <pre className="prompt-preview tall">{JSON.stringify(testResult.redactionPreview, null, 2)}</pre>
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel nested-panel">
        <div className="section-heading">
          <div>
            <h3>Run History</h3>
            <p className="item-meta">Recent Ad Studio AI runs with redacted inputs and prompt version metadata.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Task</th>
                <th>Profile</th>
                <th>Provider</th>
                <th>Model</th>
                <th>Cost</th>
                <th>Status</th>
                <th>Trace</th>
                <th>Prompt versions</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => (
                <tr key={run.id}>
                  <td>{formatDate(run.created_at)}</td>
                  <td>{run.task_type ?? String(run.input_json?.task_type ?? "-")}</td>
                  <td>{run.model_profile ?? String(run.input_json?.model_profile ?? "-")}</td>
                  <td>{run.provider_name ?? "-"}</td>
                  <td>{run.model_name ?? "-"}</td>
                  <td>{formatCost(run.cost_estimate)}</td>
                  <td>
                    <StatusPill tone={run.status === "completed" ? "green" : "rose"}>{run.status}</StatusPill>
                  </td>
                  <td>
                    <Link href={`/model-control/runs/${run.id}`}>{shortTrace(run.correlation_id)}</Link>
                  </td>
                  <td>{summarizePromptVersions(run.input_json?.prompt_versions)}</td>
                </tr>
              ))}
              {!recentRuns.length ? (
                <tr>
                  <td colSpan={9}>No provider runs recorded yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function buildLineDiff(left: string, right: string): Array<{ kind: "same" | "added" | "removed"; prefix: string; text: string }> {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const rows: Array<{ kind: "same" | "added" | "removed"; prefix: string; text: string }> = [];
  const max = Math.max(leftLines.length, rightLines.length);

  for (let index = 0; index < max; index += 1) {
    const before = leftLines[index] ?? "";
    const after = rightLines[index] ?? "";

    if (before === after) {
      rows.push({ kind: "same", prefix: " ", text: before });
    } else {
      if (before) rows.push({ kind: "removed", prefix: "-", text: before });
      if (after) rows.push({ kind: "added", prefix: "+", text: after });
    }
  }

  return rows;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "-";
}

function formatCost(value: number | string | null): string {
  const amount = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(amount) ? `$${amount!.toFixed(2)}` : "-";
}

function shortTrace(value: string | null): string {
  if (!value) return "-";
  return value.length <= 12 ? value : value.slice(0, 12);
}

function summarizePromptVersions(value: unknown): string {
  if (!Array.isArray(value)) return "-";
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      return `${record.key ?? "prompt"}@${record.version ?? "fallback"}`;
    })
    .filter(Boolean)
    .join(", ");
}
