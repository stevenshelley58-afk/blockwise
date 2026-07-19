"use client";

import { FileText, Play, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { StatusPill, type StatusTone } from "@/components/status-pill";
import { compactSkillLabel, type ContentRunRow, type ContentSkillName, type PromptSetRow } from "@/lib/content-engine";

type ContentRunConsoleProps = {
  runs: ContentRunRow[];
  promptSets: PromptSetRow[];
};

type CreateRunState = {
  topic: string;
  target_audience: string;
  business_goal: string;
  primary_cta: string;
  content_angle: string;
  offer: string;
  state_focus: string;
  tone_profile: string;
  prompt_set_id: string;
};

const DEFAULT_FORM: CreateRunState = {
  topic: "Why most real estate agents get bad leads from Meta",
  target_audience: "Australian real estate agents",
  business_goal: "Generate Blockwise demo leads",
  primary_cta: "Book a Blockwise demo",
  content_angle: "Meta is optimising toward the wrong signal",
  offer: "Free Blockwise Seller Lead Audit",
  state_focus: "WA",
  tone_profile: "direct, expert, no hype",
  prompt_set_id: "",
};

export function ContentRunConsole({ runs, promptSets }: ContentRunConsoleProps) {
  const [form, setForm] = useState<CreateRunState>(() => ({
    ...DEFAULT_FORM,
    prompt_set_id: promptSets[0]?.id ?? "",
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const metrics = useMemo(() => buildRunMetrics(runs), [runs]);

  async function submitRun(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("Creating run...");

    try {
      const response = await fetch("/api/operator/content-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          status: "draft_only",
          prompt_set_id: form.prompt_set_id || undefined,
          word_count: 1400,
          image_style: "premium SaaS, minimal, navy/off-white, no low-quality artifacts",
          publish_target: "blockwise.sale/guides",
        }),
      });
      const payload = (await response.json()) as {
        run?: { id?: string };
        queueJobId?: string | null;
        queueError?: string | null;
        error?: unknown;
      };

      if (!response.ok && !payload.run) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Unable to create content run.");
      }

      setMessage(payload.queueError ? `Run saved. Hermes queue warning: ${payload.queueError}` : "Run queued for Hermes.");
      if (payload.run?.id) {
        window.location.href = `/operator/content-runs/${payload.run.id}`;
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create content run.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="content-run-console">
      <section className="grid cols-4">
        <Metric label="Draft runs" value={String(runs.length)} />
        <Metric label="Queued or running" value={String(metrics.active)} />
        <Metric label="Waiting review" value={String(metrics.waitingReview)} />
        <Metric label="Failed" value={String(metrics.failed)} tone={metrics.failed > 0 ? "rose" : "green"} />
      </section>

      <section className="content-run-layout">
        <form className="panel content-run-form" onSubmit={submitRun}>
          <div className="row-between">
            <h2>New Blockwise Authority Run</h2>
            <StatusPill tone="blue">draft only</StatusPill>
          </div>
          <label>
            Topic
            <input value={form.topic} onChange={(event) => setFormValue(setForm, "topic", event.target.value)} />
          </label>
          <div className="grid cols-2">
            <label>
              Audience
              <input value={form.target_audience} onChange={(event) => setFormValue(setForm, "target_audience", event.target.value)} />
            </label>
            <label>
              State focus
              <input value={form.state_focus} onChange={(event) => setFormValue(setForm, "state_focus", event.target.value)} />
            </label>
          </div>
          <label>
            Business goal
            <input value={form.business_goal} onChange={(event) => setFormValue(setForm, "business_goal", event.target.value)} />
          </label>
          <label>
            Content angle
            <input value={form.content_angle} onChange={(event) => setFormValue(setForm, "content_angle", event.target.value)} />
          </label>
          <div className="grid cols-2">
            <label>
              Offer
              <input value={form.offer} onChange={(event) => setFormValue(setForm, "offer", event.target.value)} />
            </label>
            <label>
              Primary CTA
              <input value={form.primary_cta} onChange={(event) => setFormValue(setForm, "primary_cta", event.target.value)} />
            </label>
          </div>
          <div className="grid cols-2">
            <label>
              Tone
              <input value={form.tone_profile} onChange={(event) => setFormValue(setForm, "tone_profile", event.target.value)} />
            </label>
            <label>
              Prompt set
              <select value={form.prompt_set_id} onChange={(event) => setFormValue(setForm, "prompt_set_id", event.target.value)}>
                {promptSets.map((set) => (
                  <option value={set.id} key={set.id}>{set.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions">
            <button className="button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <RefreshCw aria-hidden size={16} /> : <Play aria-hidden size={16} />}
              Generate
            </button>
            <Link className="button secondary" href="/operator/content-prompts">
              Edit prompts
            </Link>
            {message ? <span className="item-meta" aria-live="polite">{message}</span> : null}
          </div>
        </form>

        <section className="panel">
          <h2>Recent Runs</h2>
          <div className="table-wrap">
            <table className="table responsive-card-table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Status</th>
                  <th>Step</th>
                  <th>Created</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td data-label="Topic">
                      <strong>{run.topic}</strong>
                      <p className="item-meta">{run.offer} · {run.primary_cta}</p>
                    </td>
                    <td data-label="Status"><StatusPill tone={toneForStatus(run.status)}>{run.status.replace(/_/g, " ")}</StatusPill></td>
                    <td data-label="Step">{run.current_step ? compactSkillLabel(run.current_step as ContentSkillName) : "—"}</td>
                    <td data-label="Created">{formatDate(run.created_at)}</td>
                    <td data-label="Open">
                      <Link className="icon-button" href={`/operator/content-runs/${run.id}`} aria-label={`Open ${run.topic}`} title="Open run">
                        <FileText aria-hidden size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No content runs yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: StatusTone }) {
  return (
    <article className="metric-card content-run-metric">
      <span className="metric-label">{label}</span>
      <strong className={tone ? `content-run-metric-value ${tone}` : "content-run-metric-value"}>{value}</strong>
    </article>
  );
}

function setFormValue(setForm: React.Dispatch<React.SetStateAction<CreateRunState>>, key: keyof CreateRunState, value: string) {
  setForm((current) => ({ ...current, [key]: value }));
}

function buildRunMetrics(runs: ContentRunRow[]) {
  return {
    active: runs.filter((run) => !["waiting_operator_approval", "failed", "approved", "published"].includes(run.status)).length,
    waitingReview: runs.filter((run) => run.status === "waiting_operator_approval").length,
    failed: runs.filter((run) => run.status === "failed").length,
  };
}

function toneForStatus(status: string): StatusTone {
  if (status === "failed") return "rose";
  if (status === "waiting_operator_approval" || status === "approved") return "green";
  if (status === "queued") return "amber";
  return "blue";
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
