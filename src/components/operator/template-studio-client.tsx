"use client";

// Template Studio [id] (Track C, §5.2). The editor mounts in studio mode
// inside the .tw bridge; the surrounding control chrome is the operator
// shell. Source-diff overlays the original ad at 50% opacity; Approve
// re-runs the fidelity gate server-side and requires the human confirmation
// checkbox — the AI critic never approves.

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AdTemplateDocV2, TextLayer } from "@/lib/adstudio/v2/template-doc";

const SAFE_SAMPLE_ASSETS = [
  { src: "/adstudio-safe-assets/contemporary-home-blue-hour.webp", label: "Contemporary home · blue hour" },
  { src: "/adstudio-safe-assets/luxury-home-portrait-blue-hour.webp", label: "Luxury home · portrait blue hour" },
  { src: "/adstudio-safe-assets/warm-contemporary-interior.webp", label: "Warm contemporary interior" },
  { src: "/adstudio-safe-assets/professional-agent-portrait.webp", label: "Professional agent portrait" },
] as const;

function defaultSafeAsset(input: { key: string; label: string }): string {
  const hint = `${input.key} ${input.label}`;
  if (/agent|headshot|profile/i.test(hint)) return "/adstudio-safe-assets/professional-agent-portrait.webp";
  if (/interior|kitchen|living|room/i.test(hint)) return "/adstudio-safe-assets/warm-contemporary-interior.webp";
  if (/portrait|vertical|story/i.test(hint)) return "/adstudio-safe-assets/luxury-home-portrait-blue-hour.webp";
  return "/adstudio-safe-assets/contemporary-home-blue-hour.webp";
}

type FidelityReport = {
  residuals: Record<string, number>;
  threshold: number;
  templateHash: string;
  outsideDifferingPixels: number;
};

export function TemplateStudioScreen({ id }: { id: string }) {
  const [doc, setDoc] = useState<AdTemplateDocV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<FidelityReport | null>(null);
  const [approved, setApproved] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [showSafeZones, setShowSafeZones] = useState(true);
  const [safeCopy, setSafeCopy] = useState<Record<string, string>>({});
  const [safeAssets, setSafeAssets] = useState<Record<string, string>>({});
  const [curationRationale, setCurationRationale] = useState("");
  const [sourceCurated, setSourceCurated] = useState(false);
  const [curating, setCurating] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/operator/template-studio/${id}?view=review`);
    if (!response.ok) {
      setError((await response.json().catch(() => ({}))).error ?? "Template unavailable.");
      return;
    }
    const payload = (await response.json()) as {
      doc: AdTemplateDocV2;
      sourceCuration?: { accepted?: boolean; rationale?: string } | null;
    };
    setDoc(payload.doc);
    setSafeCopy(Object.fromEntries(payload.doc.inputs.text.map((input) => [input.key, input.sample])));
    const existingAssets = new Map((payload.doc.restyle.safeReplacementAssets ?? []).map((asset) => [asset.inputKey, asset.src]));
    setSafeAssets(Object.fromEntries(payload.doc.inputs.images.map((input) => [
      input.key,
      existingAssets.get(input.key) ?? defaultSafeAsset(input),
    ])));
    setSourceCurated(Boolean(payload.sourceCuration?.accepted));
    setCurationRationale(payload.sourceCuration?.rationale ?? "");
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const response = await fetch(`/api/operator/template-studio/${id}?action=check`, { method: "POST" });
      const payload = (await response.json()) as {
        residuals?: Record<string, number>;
        threshold?: number;
        residualEvidence?: { templateHash?: string; outside?: { differingPixels?: number } };
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Check failed.");
      setReport({
        residuals: payload.residuals ?? {},
        threshold: payload.threshold ?? 0.14,
        templateHash: payload.residualEvidence?.templateHash ?? "",
        outsideDifferingPixels: payload.residualEvidence?.outside?.differingPixels ?? -1,
      });
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
        body: JSON.stringify({
          confirmed: confirm,
          templateHash: report?.templateHash,
          stressMatrixHash,
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; problems?: string[]; residuals?: Record<string, number> };
      if (!response.ok || !payload.ok) {
        throw new Error((payload.problems ?? ["Approve failed."]).join(" · "));
      }
      setApproved(true);
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
  const [stressMatrixHash, setStressMatrixHash] = useState<string | null>(null);
  const [stressRunning, setStressRunning] = useState(false);
  const [restyleRunning, setRestyleRunning] = useState(false);
  const curateSource = async () => {
    setCurating(true);
    setError(null);
    try {
      const response = await fetch(`/api/operator/template-studio/${id}?action=curate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rationale: curationRationale }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Source curation failed.");
      setSourceCurated(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Source curation failed.");
    } finally {
      setCurating(false);
    }
  };
  const restyle = async () => {
    setRestyleRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/operator/template-studio/${id}?action=restyle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: safeCopy, assets: safeAssets }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Restyle failed.");
      setReport(null);
      setStress([]);
      setStressMatrixHash(null);
      setConfirm(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Restyle failed.");
    } finally {
      setRestyleRunning(false);
    }
  };
  const runStress = async () => {
    setStressRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/operator/template-studio/${id}?action=stress`, { method: "POST" });
      const payload = (await response.json()) as {
        renders?: Array<{ name: string; dataUrl: string }>;
        matrixHash?: string;
        templateHash?: string;
        error?: string;
      };
      if (!response.ok || !payload.renders) throw new Error(payload.error ?? "Stress failed.");
      setStress(payload.renders);
      setStressMatrixHash(payload.matrixHash ?? null);
      if (report && payload.templateHash && payload.templateHash !== report.templateHash) setReport(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Stress failed.");
    } finally {
      setStressRunning(false);
    }
  };

  if (!doc) {
    if (error) {
      return (
        <div className="grid max-w-xl gap-3 rounded-(--r-card) border border-[var(--danger,#e5484d)] bg-[color-mix(in_srgb,var(--danger,#e5484d)_8%,transparent)] p-4 text-sm text-[var(--danger,#e5484d)]" role="alert">
          <p>{error}</p>
          <button className="w-fit rounded-(--r-button) border border-current px-3 py-1.5 font-semibold" type="button" onClick={() => { setError(null); void load(); }}>
            Try again
          </button>
        </div>
      );
    }
    return <p className="text-sm text-[var(--muted)]">Loading template…</p>;
  }

  const sourceFile = doc.provenance.sourceAd.file;

  return (
    <div className="grid gap-4">
      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-(--r-card) border border-[var(--danger,#e5484d)] bg-[color-mix(in_srgb,var(--danger,#e5484d)_8%,transparent)] p-3 text-sm text-[var(--danger,#e5484d)]" role="alert">
          <span>{error}</span>
          <button className="font-bold" type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button>
        </div>
      ) : null}
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{doc.id}</h1>
        <span className="rounded-full border border-[var(--line)] px-2.5 py-0.5 text-xs font-bold uppercase">{doc.exactness.status}</span>
        {doc.exactness.reviewEvidence ? (
          <span className="text-xs text-[var(--muted)]">
            Reviewed by {doc.exactness.reviewEvidence.reviewerEmail} at {doc.exactness.reviewEvidence.reviewedAt}
          </span>
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

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-3 rounded-(--r-card) border border-[var(--line)] p-3">
          <div>
            <strong className="text-sm">1. Curate the real source</strong>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Reject weak composition before any template work. Acceptance is recorded against your authenticated operator account.
            </p>
          </div>
          {sourceFile ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/operator/template-studio/source?id=${encodeURIComponent(id)}`}
              alt="Private source ad for curation"
              className="max-h-[34rem] w-full rounded-md border border-[var(--line)] bg-black/5 object-contain"
            />
          ) : null}
          <label className="grid gap-1 text-xs font-semibold">
            Why this source is worth cloning
            <textarea
              className="min-h-24 rounded-md border border-[var(--line)] bg-transparent p-2 text-sm font-normal"
              value={curationRationale}
              onChange={(event) => {
                setCurationRationale(event.target.value);
                setSourceCurated(false);
              }}
              placeholder="Describe the visual hierarchy, offer clarity, trust signals and why the layout will survive customer copy."
            />
          </label>
          <button className="studio-btn" type="button" onClick={curateSource} disabled={curating || curationRationale.trim().length < 20}>
            {curating ? "Recording curation…" : sourceCurated ? "Source accepted" : "Accept source"}
          </button>
        </div>

        <div className="grid content-start gap-3 rounded-(--r-card) border border-[var(--line)] p-3">
          <div>
            <strong className="text-sm">2. Build the safe public sample</strong>
            <p className="mt-1 text-xs text-[var(--muted)]">
              The source layout stays intact. Every visible input is replaced with safe copy and hash-verified original photography.
            </p>
          </div>
          <div className="grid gap-2">
            {doc.inputs.text.map((input) => (
              <label key={input.key} className="grid gap-1 text-xs font-semibold">
                {input.label} <span className="font-normal text-[var(--muted)]">({input.maxLength} characters max)</span>
                <input
                  className="rounded-md border border-[var(--line)] bg-transparent px-2 py-1.5 text-sm font-normal"
                  value={safeCopy[input.key] ?? ""}
                  maxLength={input.maxLength}
                  onChange={(event) => setSafeCopy((current) => ({ ...current, [input.key]: event.target.value }))}
                />
              </label>
            ))}
            {doc.inputs.images.map((input) => (
              <label key={input.key} className="grid gap-1 text-xs font-semibold">
                {input.label}
                <select
                  className="rounded-md border border-[var(--line)] bg-transparent px-2 py-1.5 text-sm font-normal"
                  value={safeAssets[input.key] ?? SAFE_SAMPLE_ASSETS[0].src}
                  onChange={(event) => setSafeAssets((current) => ({ ...current, [input.key]: event.target.value }))}
                >
                  {SAFE_SAMPLE_ASSETS.map((asset) => <option key={asset.src} value={asset.src}>{asset.label}</option>)}
                </select>
              </label>
            ))}
          </div>
          <button className="studio-btn" type="button" onClick={restyle} disabled={restyleRunning || !sourceCurated}>
            {restyleRunning ? "Building safe sample…" : "Build safe sample"}
          </button>
          {!sourceCurated ? <p className="text-xs text-[var(--muted)]">Accept the source first.</p> : null}
        </div>
      </section>

      {stress.length > 0 ? (
        <section className="rounded-(--r-card) border border-[var(--line)] p-3">
          <strong className="text-sm">3. Inspect all ten stress renders</strong>
          <p className="mt-1 text-xs text-[var(--muted)]">Both placements, longest and shortest copy, minimum resolution, and hostile portrait/landscape crops.</p>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {stress.map((item) =>
              item.dataUrl ? (
                <figure key={item.name} className="m-0 grid content-start gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.dataUrl} alt={`Stress render: ${item.name}`} className="max-h-80 w-full rounded border border-[var(--line)] bg-black/5 object-contain" />
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
          <strong className="text-sm">Native-source fidelity</strong>
          <p className={report.outsideDifferingPixels === 0 ? "mt-1 text-[var(--muted)]" : "mt-1 text-[var(--danger,#e5484d)]"}>
            Outside editable text: {report.outsideDifferingPixels === 0 ? "exact pixel match" : `${report.outsideDifferingPixels} changed pixels — blocked`}.
          </p>
          <ul className="mt-1 grid gap-1">
            {Object.entries(report.residuals).map(([layerId, residual]) => (
              <li key={layerId} className={residual > report.threshold ? "text-[var(--danger,#e5484d)]" : ""}>
                {layerId}: {residual.toFixed(3)} {residual > report.threshold ? `— over ${report.threshold}; fix the font, sizing, or geometry` : `≤ ${report.threshold}`}
              </li>
            ))}
            {Object.keys(report.residuals).length === 0 ? <li>No editable text layers measured yet (all baked or none).</li> : null}
          </ul>
        </section>
      ) : null}

      <div className="tw">
        <div className="relative">
          <figure className="m-0 grid justify-items-center gap-2 rounded-(--r-card) border border-[var(--line)] bg-black/5 p-3">
            {/* The browser receives only the finished safe render. Raw plates and patches stay server-only. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={doc.provenance.sample.imageSrc}
              alt={`${doc.name} safe deterministic sample`}
              className="max-h-[48rem] w-full object-contain"
            />
            <figcaption className="text-xs font-semibold text-[var(--muted)]">
              Safe sample · exact deterministic renderer
            </figcaption>
          </figure>
          {showDiff && sourceFile ? (
            <div className="pointer-events-none absolute inset-0 opacity-50 mix-blend-difference">
              {/* Source ad at 50% opacity for eyeball diffing (dev-only API). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/operator/template-studio/source?id=${encodeURIComponent(id)}`} alt="Source ad overlay" className="h-full w-full object-contain" />
            </div>
          ) : null}
          {showSafeZones && doc.formats.story ? (
            <p className="text-xs text-[var(--muted)]">
              Story safe zones: keep type out of the top 250px / bottom 340px (and 672px for Reels). Check the Story tab.
            </p>
          ) : null}
        </div>
      </div>

      <FontPickerSection doc={doc} onPatched={load} />
      <BakeSection doc={doc} onPatched={load} />

      <section className="grid gap-2 rounded-(--r-card) border border-[var(--line)] p-3">
        <strong className="text-sm">4. Human release decision</strong>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
          Inspected at 100% zoom; a designer would ship this.
        </label>
        <p className="text-xs text-[var(--muted)]">
          Approval re-runs and binds the exact source fidelity, safe sample, and ten-image stress matrix to your authenticated account. The AI cannot perform this step.
        </p>
        {overThreshold.length > 0 ? (
          <p className="text-xs text-[var(--danger,#e5484d)]">
            {overThreshold.length} region{overThreshold.length === 1 ? "" : "s"} over threshold — cannot approve.
          </p>
        ) : null}
        {approved ? <p className="text-xs text-[var(--accent,#2f7cf6)]">Approved — status set to ready.</p> : null}
        {!report || report.outsideDifferingPixels !== 0 ? <p className="text-xs text-[var(--muted)]">Run the native-source check first.</p> : null}
        {!stressMatrixHash ? <p className="text-xs text-[var(--muted)]">Render and inspect the complete stress matrix first.</p> : null}
        <button
          className="studio-btn"
          type="button"
          onClick={approve}
          disabled={!confirm || !sourceCurated || !report || report.outsideDifferingPixels !== 0 || overThreshold.length > 0 || !stressMatrixHash || checking}
        >
          Approve template
        </button>
      </section>
    </div>
  );
}

/** §5.2 font picker: per text layer, re-seed the typo from the template's
 *  committed fonts (the corpus shortlist lives in the manifest). Saves the
 *  patched template through the dev-only PATCH; re-runs on reload. */
function FontPickerSection({ doc, onPatched }: { doc: AdTemplateDocV2; onPatched: () => Promise<void> }) {
  const textLayers = (doc.formats.feed?.layers ?? []).filter((layer): layer is TextLayer => layer.type === "text");
  const [busy, setBusy] = useState(false);

  const setFont = async (layerId: string, faceKey: string) => {
    const next = structuredClone(doc);
    const face = next.fonts.find((candidate) => `${candidate.fontId}:${candidate.weight}:${candidate.italic}` === faceKey);
    if (!face) return;
    setBusy(true);
    try {
      for (const layoutKey of ["feed", "story"] as const) {
        const layout = next.formats[layoutKey];
        if (!layout) continue;
        const layer = layout.layers.find((candidate) => candidate.id === layerId);
        if (layer?.type === "text") {
          layer.typo = { ...layer.typo, fontId: face.fontId, family: face.family, weight: face.weight, italic: face.italic };
        }
      }
      const response = await fetch(`/api/operator/template-studio/${doc.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Patch failed.");
      await onPatched();
    } finally {
      setBusy(false);
    }
  };

  if (doc.inputs.text.length === 0) return null;
  return (
    <section className="grid gap-3 rounded-(--r-card) border border-[var(--line)] p-3">
      <strong className="text-sm">Font picker (Studio)</strong>
      <div className="grid gap-2">
        {textLayers.map((layer) => (
          <div key={layer.id} className="flex items-center gap-2 text-[13px]">
            <span className="w-40 truncate font-semibold">{layer.inputKey}</span>
            <select
              className="rounded-md border border-[var(--line)] bg-transparent px-2 py-1 text-[13px]"
              value={`${layer.typo.fontId}:${layer.typo.weight}:${layer.typo.italic}`}
              disabled={busy}
              onChange={(event) => void setFont(layer.id, event.target.value)}
            >
              {doc.fonts.map((face) => (
                <option key={`${face.fontId}:${face.weight}:${face.italic}`} value={`${face.fontId}:${face.weight}:${face.italic}`}>
                  {face.family} {face.weight}{face.italic ? " italic" : ""}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </section>
  );
}


/** Migration cleanup for legacy templates. Ready templates cannot contain
 *  baked customer copy, so Studio only exposes the un-bake direction. */
function BakeSection({ doc, onPatched }: { doc: AdTemplateDocV2; onPatched: () => Promise<void> }) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const unbake = async (key: string) => {
    setBusyKey(key);
    try {
      const response = await fetch(`/api/operator/template-studio/${doc.id}?action=unbake&key=${encodeURIComponent(key)}`, { method: "POST" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Un-bake failed.");
      await onPatched();
    } finally {
      setBusyKey(null);
    }
  };

  if (doc.exactness.bakedTextKeys.length === 0) return null;

  return (
    <section className="grid gap-3 rounded-(--r-card) border border-[var(--line)] p-3">
      <div>
        <strong className="text-sm">Remove legacy baked copy</strong>
        <p className="mt-1 text-xs text-[var(--danger,#e5484d)]">Baked customer text blocks release. Restore every field as an editable layer, then fix its typography and geometry.</p>
      </div>
      <div className="grid gap-2">
        {doc.inputs.text.filter((input) => doc.exactness.bakedTextKeys.includes(input.key)).map((input) => {
          const layerId = (doc.formats.feed?.layers ?? []).find((layer) => layer.type === "text" && layer.inputKey === input.key)?.id ?? null;
          const residual = (doc.exactness.residuals ?? {})[layerId ?? ""];
          return (
            <div key={input.key} className="flex items-center gap-2 text-[13px]">
              <span className="w-40 truncate font-semibold">{input.key}</span>
              <span className={typeof residual === "number" && residual > 0.14 ? "text-[var(--danger,#e5484d)]" : "text-[var(--muted)]"}>
                {typeof residual === "number" ? residual.toFixed(3) : "baked"}
              </span>
              <button
                className="studio-btn secondary"
                type="button"
                disabled={busyKey === input.key}
                onClick={() => void unbake(input.key)}
              >
                {busyKey === input.key ? "Restoring…" : "Restore editable layer"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
