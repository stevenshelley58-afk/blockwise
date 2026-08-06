"use client";

// Template Studio [id] (Track C, §5.2). The editor mounts in studio mode
// inside the .tw bridge; the surrounding control chrome is the operator
// shell. Source-diff overlays the original ad at 50% opacity; Approve
// re-runs the fidelity gate server-side and requires the human confirmation
// checkbox — the AI critic never approves.

import { useCallback, useEffect, useMemo, useState } from "react";

import { EditorRoot } from "@/components/adstudio/editor/editor-root";
import type { AdTemplateDocV2 } from "@/lib/adstudio/v2/template-doc";

export function TemplateStudioScreen({ id }: { id: string }) {
  const [doc, setDoc] = useState<AdTemplateDocV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<{ residuals: Record<string, number>; threshold: number } | null>(null);
  const [approved, setApproved] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [showSafeZones, setShowSafeZones] = useState(true);

  const load = useCallback(async () => {
    const response = await fetch(`/api/operator/template-studio/${id}`);
    if (!response.ok) {
      setError((await response.json().catch(() => ({}))).error ?? "Template unavailable.");
      return;
    }
    setDoc((await response.json()) as AdTemplateDocV2);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: AdTemplateDocV2) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/operator/template-studio/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Save failed.");
      setDoc(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const response = await fetch(`/api/operator/template-studio/${id}?action=check`, { method: "POST" });
      const payload = (await response.json()) as { residuals?: Record<string, number>; threshold?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Check failed.");
      setReport({ residuals: payload.residuals ?? {}, threshold: payload.threshold ?? 0.14 });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check failed.");
    } finally {
      setChecking(false);
    }
  };

  const approve = async () => {
    setChecking(true);
    setError(null);
    setApproved(false);
    try {
      const response = await fetch(`/api/operator/template-studio/${id}?action=approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: confirm }),
      });
      const payload = (await response.json()) as { ok?: boolean; problems?: string[]; residuals?: Record<string, number> };
      if (!response.ok || !payload.ok) {
        throw new Error((payload.problems ?? ["Approve failed."]).join(" · "));
      }
      setApproved(true);
      setReport({ residuals: payload.residuals ?? {}, threshold: 0.14 });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Approve failed.");
    } finally {
      setChecking(false);
    }
  };

  const overThreshold = useMemo(
    () => Object.entries(report?.residuals ?? {}).filter(([, residual]) => residual > (report?.threshold ?? 0.14)),
    [report],
  );

  const [stress, setStress] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [stressRunning, setStressRunning] = useState(false);
  const runStress = async () => {
    setStressRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/operator/template-studio/${id}?action=stress`, { method: "POST" });
      const payload = (await response.json()) as { renders?: Array<{ name: string; dataUrl: string }>; error?: string };
      if (!response.ok || !payload.renders) throw new Error(payload.error ?? "Stress failed.");
      setStress(payload.renders);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Stress failed.");
    } finally {
      setStressRunning(false);
    }
  };

  if (error) return <p className="text-sm text-[var(--danger,#e5484d)]">{error}</p>;
  if (!doc) return <p className="text-sm text-[var(--muted)]">Loading template…</p>;

  const sourceFile = doc.provenance.sourceAd.file;

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{doc.id}</h1>
        <span className="rounded-full border border-[var(--line)] px-2.5 py-0.5 text-xs font-bold uppercase">{doc.exactness.status}</span>
        {doc.exactness.qaBy ? (
          <span className="text-xs text-[var(--muted)]">QA by {doc.exactness.qaBy} at {doc.exactness.qaAt}</span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold">
            <input type="checkbox" checked={showDiff} onChange={(event) => setShowDiff(event.target.checked)} />
            Diff source
          </label>
          <label className="flex items-center gap-1.5 text-xs font-semibold">
            <input type="checkbox" checked={showSafeZones} onChange={(event) => setShowSafeZones(event.target.checked)} />
            Safe zones
          </label>
          <button className="studio-btn secondary" type="button" onClick={check} disabled={checking}>
            {checking ? "Running gate…" : "Run check"}
          </button>
          <button className="studio-btn secondary" type="button" onClick={runStress} disabled={stressRunning}>
            {stressRunning ? "Rendering stress…" : "Stress preview"}
          </button>
        </div>
      </header>

      {stress.length > 0 ? (
        <section className="rounded-(--r-card) border border-[var(--line)] p-3">
          <strong className="text-sm">Stress preview matrix</strong>
          <div className="mt-2 flex flex-wrap gap-3">
            {stress.map((item) =>
              item.dataUrl ? (
                <figure key={item.name} className="m-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.dataUrl} alt={`Stress render: ${item.name}`} className="h-64 w-auto rounded border border-[var(--line)]" />
                  <figcaption className="text-[11px] font-semibold text-[var(--muted)]">{item.name}</figcaption>
                </figure>
              ) : (
                <p key={item.name} className="text-[13px] font-semibold text-[var(--danger,#e5484d)]">{item.name}</p>
              ),
            )}
          </div>
        </section>
      ) : null}

      {report ? (
        <section className="rounded-(--r-card) border border-[var(--line)] p-3 text-xs">
          <strong className="text-sm">Fidelity report (source values vs source ad)</strong>
          <ul className="mt-1 grid gap-1">
            {Object.entries(report.residuals).map(([layerId, residual]) => (
              <li key={layerId} className={residual > report.threshold ? "text-[var(--danger,#e5484d)]" : ""}>
                {layerId}: {residual.toFixed(3)} {residual > report.threshold ? `— over ${report.threshold}, fix the font or bake` : `≤ ${report.threshold}`}
              </li>
            ))}
            {Object.keys(report.residuals).length === 0 ? <li>No editable text layers measured yet (all baked or none).</li> : null}
          </ul>
        </section>
      ) : null}

      <div className="tw">
        <div className="relative">
          <EditorRoot template={doc} instance={{
            schema: "adstudio.instance.v2",
            templateId: doc.id,
            templateHash: "0".repeat(64),
            format: "4:5",
            values: { images: {}, text: Object.fromEntries(doc.inputs.text.map((input) => [input.key, input.sample])) },
            overrides: [],
          }} mode="studio" onSave={async () => undefined} />
          {showDiff && sourceFile ? (
            <div className="pointer-events-none absolute inset-0 opacity-50 mix-blend-difference">
              {/* Source ad at 50% opacity for eyeball diffing (dev-only API). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/operator/template-studio/source?id=${encodeURIComponent(id)}`} alt="Source ad overlay" className="h-full w-full object-cover" />
            </div>
          ) : null}
          {showSafeZones && doc.formats.story ? (
            <p className="text-xs text-[var(--muted)]">
              Story safe zones: keep type out of the top 250px / bottom 340px (and 672px for Reels). Check the Story tab.
            </p>
          ) : null}
        </div>
      </div>

      <section className="grid gap-2 rounded-(--r-card) border border-[var(--line)] p-3">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
          Inspected at 100% zoom; a designer would ship this.
        </label>
        <p className="text-xs text-[var(--muted)]">
          Approve re-runs the gate: story present, restyle recorded, sample ≠ source, residuals ≤ 0.14. The human holds this button.
        </p>
        {overThreshold.length > 0 ? (
          <p className="text-xs text-[var(--danger,#e5484d)]">
            {overThreshold.length} region{overThreshold.length === 1 ? "" : "s"} over threshold — cannot approve.
          </p>
        ) : null}
        {approved ? <p className="text-xs text-[var(--accent,#2f7cf6)]">Approved — status set to ready.</p> : null}
        <button className="studio-btn" type="button" onClick={approve} disabled={!confirm || checking || saving}>
          Approve template
        </button>
      </section>
    </div>
  );
}
