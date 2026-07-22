"use client";

import { Check, RefreshCw, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";

import { StatusPill, type StatusTone } from "@/components/status-pill";
import { CONTENT_STEPS, compactSkillLabel, type ContentArtifactRow, type ContentReviewRow, type ContentRunRow, type ContentSkillName } from "@/lib/content-engine";

type ContentRunReviewProps = {
  run: ContentRunRow;
  artifacts: ContentArtifactRow[];
  reviews: ContentReviewRow[];
  approvals: Array<Record<string, unknown>>;
  promptRuns: Array<Record<string, unknown>>;
};

const ARTIFACT_ORDER = [
  "research_brief",
  "strategy_brief",
  "blog_draft",
  "blog_final",
  "formatted_page",
  "seo_schema",
  "image_prompt",
  "social_facebook",
  "social_instagram",
  "lead_ad",
  "instant_form",
  "compliance_report",
  "review_report",
  "artifact_package",
] as const;

export function ContentRunReview({ run, artifacts, reviews, approvals, promptRuns }: ContentRunReviewProps) {
  const latestArtifacts = useMemo(() => latestByType(artifacts), [artifacts]);
  const [activeType, setActiveType] = useState<string>(ARTIFACT_ORDER.find((type) => latestArtifacts[type]) ?? "blog_final");
  const [message, setMessage] = useState("");
  const activeArtifact = latestArtifacts[activeType];
  const finalReview = reviews.find((review) => review.review_type === "final_agent");
  const compliance = reviews.find((review) => review.review_type === "compliance");

  async function approveArtifact(status: "approved" | "rejected") {
    if (!activeArtifact) return;
    setMessage(status === "approved" ? "Approving..." : "Rejecting...");

    try {
      const response = await fetch(`/api/operator/content-runs/${run.id}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactType: activeArtifact.artifact_type, status }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Approval update failed.");
      }
      setMessage(status === "approved" ? "Artifact approved." : "Artifact rejected.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Approval update failed.");
    }
  }

  async function rerun(fromStep: ContentSkillName) {
    setMessage("Queueing rerun...");

    try {
      const response = await fetch(`/api/operator/content-runs/${run.id}/rerun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromStep }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Rerun failed to queue.");
      }
      setMessage("Rerun queued for Hermes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rerun failed to queue.");
    }
  }

  return (
    <div className="content-review-grid">
      <aside className="panel content-review-sidebar">
        <div className="row-between">
          <h2>Run State</h2>
          <StatusPill tone={toneForStatus(run.status)}>{run.status.replace(/_/g, " ")}</StatusPill>
        </div>
        <p className="item-meta">{run.offer}</p>
        {run.error_message ? <p className="form-error">{run.error_message}</p> : null}
        <div className="content-review-score">
          <span>Review score</span>
          <strong>{finalReview?.score ? Math.round(finalReview.score) : "—"}</strong>
        </div>
        <div className="content-review-score">
          <span>Compliance</span>
          <strong>{compliance?.status ?? "pending"}</strong>
        </div>
        <label>
          Rerun from step
          <select onChange={(event) => event.target.value ? void rerun(event.target.value as ContentSkillName) : undefined} defaultValue="">
            <option value="">Choose step</option>
            {CONTENT_STEPS.map((step) => (
              <option value={step.skillName} key={step.skillName}>{compactSkillLabel(step.skillName)}</option>
            ))}
          </select>
        </label>
        {message ? <p className="item-meta" aria-live="polite">{message}</p> : null}
      </aside>

      <main className="panel content-review-main">
        <div className="content-artifact-tabs">
          {ARTIFACT_ORDER.filter((type) => latestArtifacts[type]).map((type) => (
            <button
              className={activeType === type ? "content-artifact-tab active" : "content-artifact-tab"}
              type="button"
              key={type}
              onClick={() => setActiveType(type)}
            >
              {artifactLabel(type)}
            </button>
          ))}
        </div>

        {activeArtifact ? (
          <article className="content-artifact-panel" id={activeArtifact.artifact_type === "blog_final" ? "guide-preview" : undefined}>
            <div className="row-between">
              <div>
                <h2>{activeArtifact.title}</h2>
                <p className="item-meta">
                  {activeArtifact.model_used ?? "model pending"} · prompt v{activeArtifact.prompt_version ?? "—"}
                </p>
              </div>
              <div className="actions">
                <button className="button secondary" type="button" onClick={() => void approveArtifact("rejected")}>
                  <X aria-hidden size={16} />
                  Reject
                </button>
                <button className="button" type="button" onClick={() => void approveArtifact("approved")}>
                  <Check aria-hidden size={16} />
                  Approve
                </button>
              </div>
            </div>
            <ArtifactPreview artifact={activeArtifact} />
          </article>
        ) : (
          <p>No artifacts have been generated yet.</p>
        )}
      </main>

      <section className="panel content-review-trace">
        <div className="row-between">
          <h2>Trace</h2>
          <RotateCcw aria-hidden size={18} />
        </div>
        <table className="table responsive-card-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Model</th>
              <th>Prompt</th>
            </tr>
          </thead>
          <tbody>
            {promptRuns.slice(0, 12).map((runItem) => (
              <tr key={String(runItem.id)}>
                <td data-label="Skill">{compactSkillLabel(String(runItem.skill_name) as ContentSkillName)}</td>
                <td data-label="Model">{String(runItem.model_used ?? "—")}</td>
                <td data-label="Prompt">{String(runItem.prompt_version ?? "—")}</td>
              </tr>
            ))}
            {promptRuns.length === 0 ? (
              <tr>
                <td colSpan={3}>No prompt runs recorded yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <h2>Approvals</h2>
        <div className="content-approval-list">
          {approvals.map((approval) => (
            <span className="status blue" key={`${approval.artifact_type}-${approval.approval_status}`}>
              {artifactLabel(String(approval.artifact_type))}: {String(approval.approval_status)}
            </span>
          ))}
          {approvals.length === 0 ? <p className="item-meta">No operator approvals yet.</p> : null}
        </div>
      </section>
    </div>
  );
}

function ArtifactPreview({ artifact }: { artifact: ContentArtifactRow }) {
  const data = artifact.data_json as Record<string, unknown>;
  const markdown = typeof data.edited_markdown === "string"
    ? data.edited_markdown
    : typeof data.body_markdown === "string"
      ? data.body_markdown
      : null;

  if (markdown) {
    return <pre className="content-markdown-preview">{markdown}</pre>;
  }

  return <pre className="content-json-preview">{JSON.stringify(artifact.data_json, null, 2)}</pre>;
}

function latestByType(artifacts: ContentArtifactRow[]): Record<string, ContentArtifactRow> {
  const sorted = [...artifacts].sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
  const latest: Record<string, ContentArtifactRow> = {};
  for (const artifact of sorted) latest[artifact.artifact_type] = artifact;
  return latest;
}

function artifactLabel(type: string): string {
  return type.replace(/^blog_/u, "guide_").replace(/_/gu, " ");
}

function toneForStatus(status: string): StatusTone {
  if (status === "failed") return "rose";
  if (status === "waiting_operator_approval" || status === "approved") return "green";
  if (status === "queued") return "amber";
  return "blue";
}
