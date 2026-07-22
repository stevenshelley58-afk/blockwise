"use client";

import { FileText, Play, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { StatusPill, type StatusTone } from "@/components/status-pill";
import { compactSkillLabel, type ContentRunRow, type ContentSkillName, type PromptSetRow } from "@/lib/content-engine";

type ContentRunConsoleProps = {
  runs: ContentRunRow[];
  promptSets: PromptSetRow[];
};

type CreateRunState = {
  source_transcript: string;
  source_url: string;
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
  source_transcript: "",
  source_url: "",
  topic: "",
  target_audience: "Real estate agents",
  business_goal: "Teach a practical idea and create qualified Blockwise interest",
  primary_cta: "Start a free Blockwise trial",
  content_angle: "Extract the strongest useful argument from the transcript",
  offer: "A practical Blockwise field guide",
  state_focus: "Nationwide",
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
          image_style: "source-led editorial photography or diagrams, factual and restrained, no synthetic people, fake screenshots, decorative AI abstractions, or readable fake UI text",
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
      <section className="content-run-layout">
        <form className="panel content-run-form" onSubmit={submitRun}>
          <div className="content-run-form-heading">
            <div>
              <h2>Create a guide from a transcript</h2>
              <p>Paste the source material. Blockwise will extract the argument, check claim risk, write the guide, and hold everything for review.</p>
            </div>
            <StatusPill tone="blue">Draft only</StatusPill>
          </div>

          <label className="content-run-transcript-field">
            Transcript
            <textarea
              value={form.source_transcript}
              onChange={(event) => setFormValue(setForm, "source_transcript", event.target.value)}
              placeholder="Paste the complete transcript here..."
              aria-describedby="source-transcript-guidance source-transcript-count"
              minLength={80}
              maxLength={100_000}
              required
            />
            <span className="content-run-transcript-meta">
              <span id="source-transcript-guidance">The transcript is source material, not copy. Distinctive phrasing is rewritten and unsupported claims are flagged.</span>
              <span id="source-transcript-count">{form.source_transcript.length.toLocaleString("en-AU")} / 100,000</span>
            </span>
          </label>

          <details className="content-run-advanced">
            <summary>Writing and campaign direction</summary>
            <div className="content-run-advanced-fields">
              <div className="grid cols-2">
                <label>
                  Working topic <span>Optional</span>
                  <input
                    value={form.topic}
                    onChange={(event) => setFormValue(setForm, "topic", event.target.value)}
                    placeholder="Derived from the transcript when blank"
                  />
                </label>
                <label>
                  Source URL <span>Optional</span>
                  <input
                    type="url"
                    value={form.source_url}
                    onChange={(event) => setFormValue(setForm, "source_url", event.target.value)}
                    placeholder="https://youtube.com/watch?v=..."
                  />
                </label>
              </div>
              <div className="grid cols-2">
                <label>
                  Intended reader
                  <input value={form.target_audience} onChange={(event) => setFormValue(setForm, "target_audience", event.target.value)} />
                </label>
                <label>
                  Market focus
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
              <Link className="content-run-prompt-link" href="/operator/content-prompts">
                Manage prompt versions
              </Link>
            </div>
          </details>

          <div className="content-run-submit-row">
            <button className="button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <RefreshCw aria-hidden size={16} /> : <Play aria-hidden size={16} />}
              {isSubmitting ? "Creating guide draft..." : "Create guide draft"}
            </button>
            <p>Nothing is published until an operator approves the finished package.</p>
          </div>
          {message ? <p className="item-meta content-run-message" aria-live="polite">{message}</p> : null}
        </form>

        <section className="panel content-run-history">
          <div className="row-between">
            <h2>Recent runs</h2>
            <span className="item-meta">{runs.length} {runs.length === 1 ? "run" : "runs"}</span>
          </div>
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

function setFormValue(setForm: React.Dispatch<React.SetStateAction<CreateRunState>>, key: keyof CreateRunState, value: string) {
  setForm((current) => ({ ...current, [key]: value }));
}

function toneForStatus(status: string): StatusTone {
  if (status === "failed") return "rose";
  if (["approved", "publish_ready", "published"].includes(status)) return "green";
  if (status === "queued" || status === "waiting_operator_approval") return "amber";
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
