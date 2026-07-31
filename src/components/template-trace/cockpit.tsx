"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type CloneRegion = {
  key: string;
  kind: "text" | "image";
  box: { x: number; y: number; width: number; height: number };
};

type TraceDetail = {
  template: {
    id: string;
    name: string;
    format: string;
    goal: string;
    offerId: string;
    audienceIntent: string;
    category: string;
    tags: string[];
    dimensions: { width: number; height: number };
    sample: { imageSrc: string; thumbnailSrc: string; contentHash: string; alt: string };
    inputs: {
      images: Array<{ key: string; label: string; required: boolean; aspect?: string; description: string }>;
      text: Array<{ key: string; label: string; maxLength: number; sample: string; required: boolean }>;
    };
    sourceAd: { file?: string; creativeId?: string; contentHash: string };
    classification: { ad_type: string; primary_intent: string; property_or_agent_focus: string };
    meta: Record<string, unknown>;
  };
  clonePrompt: string;
  negativePrompt: string;
  photoFitRule: string;
  referenceAssetOrder: string[];
  resolvedCopy: Record<string, string>;
  editPromptExample: string | null;
  sourceImageAvailable: boolean;
  sampleImagePath: string;
};

type RegenResult = {
  assetUrl: string;
  prompt: string;
  model: string;
  provider: string;
  providerAttempts: number;
  quality: string;
};

const TABS = ["Trace", "Inputs", "Text", "Regions", "Prompt", "Meta", "Regenerate"] as const;
type Tab = (typeof TABS)[number];

const REGION_COLORS = ["#5b9dff", "#ff7ac6", "#7ce38b", "#ffcf5c", "#c792ea", "#ff9e64", "#89ddff"];

export function TemplateTraceCockpit({ traceId }: { traceId: string }) {
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Trace");

  // Regions
  const [regions, setRegions] = useState<CloneRegion[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [showRegions, setShowRegions] = useState(true);
  const [compareTarget, setCompareTarget] = useState<"source" | "regen">("source");

  // Regen
  const [copyEdits, setCopyEdits] = useState<Record<string, string>>({});
  const [quality, setQuality] = useState<"fast" | "high">("fast");
  const [regenerating, setRegenerating] = useState(false);
  const [regen, setRegen] = useState<RegenResult | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);

  // Slider wipe position (0..100)
  const [wipe, setWipe] = useState(50);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/operator/template-trace/${encodeURIComponent(traceId)}`);
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const data = await res.json();
        if (!cancelled) setTrace(data.trace);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load trace");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  const sourceSrc = `/api/operator/template-trace/${encodeURIComponent(traceId)}/source-image`;
  const sampleSrc = trace?.sampleImagePath ?? "";

  const handleDetect = useCallback(async () => {
    setDetecting(true);
    try {
      const res = await fetch(`/api/operator/template-trace/${encodeURIComponent(traceId)}/detect-regions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`Detection failed (${res.status})`);
      const data = await res.json();
      setRegions(data.regions);
      setTab("Regions");
    } catch (e) {
      setRegions([]);
      alert(e instanceof Error ? e.message : "Region detection failed");
    } finally {
      setDetecting(false);
    }
  }, [traceId]);

  const handleRegen = useCallback(async () => {
    if (!trace) return;
    setRegenerating(true);
    setRegenError(null);
    try {
      const res = await fetch(`/api/operator/template-trace/${encodeURIComponent(traceId)}/regenerate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quality, copy: copyEdits }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Generation failed (${res.status})`);
      setRegen(data);
      setCompareTarget("regen");
      setTab("Regenerate");
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setRegenerating(false);
    }
  }, [trace, traceId, quality, copyEdits]);

  const rightImage = useMemo(() => {
    if (compareTarget === "regen" && regen) return regen.assetUrl;
    return sampleSrc;
  }, [compareTarget, regen, sampleSrc]);

  if (loading) return <main className="content"><p style={{ opacity: 0.6 }}>Loading trace…</p></main>;
  if (error || !trace) {
    return (
      <main className="content">
        <p style={{ color: "#ff7ac6" }}>{error ?? "Trace not found."}</p>
        <Link href="/operator/template-trace">← Back to all templates</Link>
      </main>
    );
  }

  const t = trace.template;

  return (
    <main className="content tt-surface">
      <style>{TT_CSS}</style>

      <div className="tt-header">
        <div>
          <Link href="/operator/template-trace" className="tt-back">← All templates</Link>
          <h1 style={{ margin: "6px 0 2px" }}>{t.name}</h1>
          <div className="tt-idline">
            <code>{t.id}</code>
            <span className="tt-badge tt-badge-blue">{t.format}</span>
            <span className="tt-badge tt-badge-purple">{t.classification.primary_intent}</span>
            <span className="tt-badge">{t.classification.property_or_agent_focus}</span>
            <span className="tt-badge">{t.dimensions.width}×{t.dimensions.height}</span>
          </div>
        </div>
      </div>

      {/* Image comparison stage */}
      <section className="panel tt-stage">
        <div className="tt-stage-head">
          <h2 style={{ margin: 0 }}>
            {compareTarget === "regen" && regen ? "Source vs Regen" : "Source vs Sample"}
          </h2>
          <div className="tt-stage-controls">
            <label className="tt-toggle">
              <input type="checkbox" checked={showRegions} onChange={(e) => setShowRegions(e.target.checked)} />
              Regions
            </label>
            {regen && (
              <div className="tt-seg">
                <button className={compareTarget === "source" ? "on" : ""} onClick={() => setCompareTarget("source")}>Sample</button>
                <button className={compareTarget === "regen" ? "on" : ""} onClick={() => setCompareTarget("regen")}>Regen</button>
              </div>
            )}
            <button className="tt-btn" onClick={handleDetect} disabled={detecting}>
              {detecting ? "Detecting…" : regions ? "Re-detect regions" : "Detect regions"}
            </button>
          </div>
        </div>

        <div className="tt-compare">
          <div className="tt-canvas" style={{ aspectRatio: t.dimensions.width / t.dimensions.height }}>
            {/* Base: right image (sample or regen) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={rightImage} alt="sample" className="tt-img tt-img-base" />
            {/* Clipped: source image on the left portion */}
            <div className="tt-img-clip" style={{ width: `${wipe}%` }}>
              {trace.sourceImageAvailable ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sourceSrc} alt="source" className="tt-img" />
              ) : (
                <div className="tt-img-missing">Source image not on disk</div>
              )}
            </div>
            {/* Region overlay on top of the right image */}
            {showRegions && regions && (
              <div className="tt-regions">
                {regions.map((r, i) => (
                  <div
                    key={`${r.key}-${i}`}
                    className="tt-region"
                    style={{
                      left: `${r.box.x * 100}%`,
                      top: `${r.box.y * 100}%`,
                      width: `${r.box.width * 100}%`,
                      height: `${r.box.height * 100}%`,
                      borderColor: REGION_COLORS[i % REGION_COLORS.length],
                    }}
                    title={`${r.key} (${r.kind})`}
                  >
                    <span style={{ background: REGION_COLORS[i % REGION_COLORS.length] }}>
                      {r.key}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* Divider handle */}
            <div className="tt-divider" style={{ left: `${wipe}%` }} />
          </div>

          <div className="tt-wipe-row">
            <span className="tt-wipe-label">Source</span>
            <input
              type="range"
              min={0}
              max={100}
              value={wipe}
              onChange={(e) => setWipe(Number(e.target.value))}
              className="tt-wipe"
            />
            <span className="tt-wipe-label">{compareTarget === "regen" && regen ? "Regen" : "Sample"}</span>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <nav className="tt-tabs">
        {TABS.map((tb) => (
          <button key={tb} className={tab === tb ? "on" : ""} onClick={() => setTab(tb)}>
            {tb}
            {tb === "Regions" && regions ? ` (${regions.length})` : ""}
          </button>
        ))}
      </nav>

      {tab === "Trace" && (
        <section className="panel">
          <h2>Reference asset order</h2>
          <p className="tt-muted">The clone prompt sends these images to the model in this exact order. Reference image 1 controls the design.</p>
          <ol className="tt-assetlist">
            {trace.referenceAssetOrder.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
          <h2 style={{ marginTop: 24 }}>Resolved sample copy</h2>
          <p className="tt-muted">These exact values are embedded in the clone prompt.</p>
          <table className="table">
            <thead><tr><th>Field</th><th>Value</th></tr></thead>
            <tbody>
              {Object.entries(trace.resolvedCopy).map(([k, v]) => (
                <tr key={k}><td><code>{k}</code></td><td>{v}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "Inputs" && (
        <section className="panel">
          <h2>Image inputs ({t.inputs.images.length})</h2>
          <div className="tt-inputgrid">
            {t.inputs.images.map((img) => (
              <article key={img.key} className="tt-inputcard">
                <div className="tt-inputcard-head">
                  <code>{img.key}</code>
                  {img.required ? <span className="tt-badge tt-badge-red">required</span> : <span className="tt-badge">optional</span>}
                  {img.aspect ? <span className="tt-badge">{img.aspect}</span> : null}
                </div>
                <strong>{img.label}</strong>
                <p className="tt-muted">{img.description}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "Text" && (
        <section className="panel">
          <h2>Text inputs ({t.inputs.text.length})</h2>
          <table className="table">
            <thead><tr><th>Key</th><th>Label</th><th>Max</th><th>Sample value</th><th>Req</th></tr></thead>
            <tbody>
              {t.inputs.text.map((txt) => (
                <tr key={txt.key}>
                  <td><code>{txt.key}</code></td>
                  <td>{txt.label}</td>
                  <td>{txt.maxLength}</td>
                  <td>{txt.sample}</td>
                  <td>{txt.required ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "Regions" && (
        <section className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2>Editable regions</h2>
            <button className="tt-btn" onClick={handleDetect} disabled={detecting}>
              {detecting ? "Detecting…" : "Run live detection"}
            </button>
          </div>
          {regions === null ? (
            <p className="tt-muted">No regions detected yet. Click “Detect regions” (top right) to run a live vision pass on the sample.</p>
          ) : regions.length === 0 ? (
            <p className="tt-muted">No regions returned. The vision model found no editable hit-boxes, or the call failed.</p>
          ) : (
            <table className="table">
              <thead><tr><th>#</th><th>Key</th><th>Kind</th><th>x</th><th>y</th><th>w</th><th>h</th></tr></thead>
              <tbody>
                {regions.map((r, i) => (
                  <tr key={`${r.key}-${i}`}>
                    <td><span className="tt-swatch" style={{ background: REGION_COLORS[i % REGION_COLORS.length] }} /></td>
                    <td><code>{r.key}</code></td>
                    <td>{r.kind}</td>
                    <td>{r.box.x.toFixed(3)}</td>
                    <td>{r.box.y.toFixed(3)}</td>
                    <td>{r.box.width.toFixed(3)}</td>
                    <td>{r.box.height.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "Prompt" && (
        <section className="panel">
          <h2>Clone prompt (buildCloneImageRequest)</h2>
          <p className="tt-muted">Reconstructed with the template’s own sample values. This is exactly what the image model receives.</p>
          <pre className="tt-code">{trace.clonePrompt}</pre>

          <h2 style={{ marginTop: 24 }}>Negative prompt</h2>
          <pre className="tt-code">{trace.negativePrompt}</pre>

          <h2 style={{ marginTop: 24 }}>Photo-fit rule</h2>
          <pre className="tt-code">{trace.photoFitRule}</pre>

          {trace.editPromptExample && (
            <>
              <h2 style={{ marginTop: 24 }}>Example targeted-edit prompt</h2>
              <p className="tt-muted">What an in-place text edit sends (first text field, sample value).</p>
              <pre className="tt-code">{trace.editPromptExample}</pre>
            </>
          )}
        </section>
      )}

      {tab === "Meta" && (
        <section className="panel">
          <h2>Campaign metadata</h2>
          <pre className="tt-code">{JSON.stringify(t.meta, null, 2)}</pre>
          <h2 style={{ marginTop: 24 }}>Provenance</h2>
          <table className="table">
            <tbody>
              <tr><td>Source file</td><td><code>{t.sourceAd.file ?? t.sourceAd.creativeId ?? "—"}</code></td></tr>
              <tr><td>Source hash</td><td><code style={{ fontSize: 11 }}>{t.sourceAd.contentHash}</code></td></tr>
              <tr><td>Sample hash</td><td><code style={{ fontSize: 11 }}>{t.sample.contentHash}</code></td></tr>
              <tr><td>Hashes differ</td><td>{t.sourceAd.contentHash !== t.sample.contentHash ? "✓ yes (required)" : "✗ NO — sample equals source"}</td></tr>
              <tr><td>Goal</td><td>{t.goal}</td></tr>
              <tr><td>Offer ID</td><td><code>{t.offerId}</code></td></tr>
              <tr><td>Audience intent</td><td>{t.audienceIntent}</td></tr>
              <tr><td>Tags</td><td>{t.tags.join(", ")}</td></tr>
            </tbody>
          </table>
        </section>
      )}

      {tab === "Regenerate" && (
        <section className="panel">
          <h2>Regenerate clone</h2>
          <p className="tt-muted">Runs the real provider with the sample as reference image 1. Nothing is persisted — the result is shown side-by-side via the “Regen” toggle above.</p>

          <div className="tt-regen-controls">
            <label className="tt-field">
              <span>Model quality</span>
              <select value={quality} onChange={(e) => setQuality(e.target.value as "fast" | "high")}>
                <option value="fast">image_draft — Gemini flash (fast, ~5s)</option>
                <option value="high">image_final — GPT (quality, ~15s)</option>
              </select>
            </label>
            <button className="tt-btn tt-btn-primary" onClick={handleRegen} disabled={regenerating}>
              {regenerating ? "Generating…" : regen ? "Regenerate again" : "Generate clone"}
            </button>
          </div>

          <h3 style={{ marginTop: 20 }}>Text overrides</h3>
          <div className="tt-copyedits">
            {t.inputs.text.map((txt) => (
              <label key={txt.key} className="tt-field">
                <span>{txt.label} <code style={{ opacity: 0.5 }}>({txt.maxLength})</code></span>
                <input
                  type="text"
                  placeholder={txt.sample}
                  value={copyEdits[txt.key] ?? ""}
                  maxLength={txt.maxLength}
                  onChange={(e) => setCopyEdits((prev) => ({ ...prev, [txt.key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <p className="tt-muted" style={{ marginTop: 8 }}>Leave blank to use the sample value.</p>

          {regenError && <p style={{ color: "#ff7ac6", marginTop: 16 }}>{regenError}</p>}

          {regen && (
            <div className="tt-regen-result">
              <h3>Result</h3>
              <table className="table">
                <tbody>
                  <tr><td>Model</td><td><code>{regen.model}</code></td></tr>
                  <tr><td>Provider</td><td>{regen.provider}</td></tr>
                  <tr><td>Attempts</td><td>{regen.providerAttempts}</td></tr>
                  <tr><td>Quality</td><td>{regen.quality}</td></tr>
                </tbody>
              </table>
              <p className="tt-muted">Use the “Regen” toggle above the image to compare against the source with the slider.</p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

const TT_CSS = `
.tt-surface { max-width: 1200px; }
.tt-back { font-size: 13px; color: var(--accent-strong); text-decoration: none; }
.tt-back:hover { text-decoration: underline; }
.tt-idline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.tt-idline code { font-size: 12px; opacity: 0.7; }
.tt-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border-soft, #333); text-transform: capitalize; }
.tt-badge-blue { border-color: #5b9dff; color: #5b9dff; }
.tt-badge-purple { border-color: #c792ea; color: #c792ea; }
.tt-badge-red { border-color: #ff7ac6; color: #ff7ac6; }
.tt-muted { color: var(--text-soft, #999); font-size: 13px; }

.tt-stage-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.tt-stage-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tt-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
.tt-seg { display: inline-flex; border: 1px solid var(--border-soft, #333); border-radius: 8px; overflow: hidden; }
.tt-seg button { background: none; border: none; color: inherit; padding: 5px 12px; font-size: 13px; cursor: pointer; }
.tt-seg button.on { background: var(--accent-strong); color: #0a0a0a; font-weight: 600; }
.tt-btn { background: none; border: 1px solid var(--border-soft, #444); color: inherit; padding: 6px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; }
.tt-btn:hover:not(:disabled) { border-color: var(--accent-strong); }
.tt-btn:disabled { opacity: 0.5; cursor: default; }
.tt-btn-primary { background: var(--accent-strong); color: #0a0a0a; border-color: var(--accent-strong); font-weight: 600; }

.tt-compare { max-width: 540px; margin: 0 auto; }
.tt-canvas { position: relative; width: 100%; overflow: hidden; border-radius: 10px; border: 1px solid var(--border-soft, #333); background: #111; }
.tt-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.tt-img-base { z-index: 1; }
.tt-img-clip { position: absolute; inset: 0; z-index: 2; overflow: hidden; }
.tt-img-clip .tt-img { width: 100%; }
.tt-img-missing { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #888; background: repeating-linear-gradient(45deg,#1a1a1a,#1a1a1a 8px,#222 8px,#222 16px); }
.tt-regions { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
.tt-region { position: absolute; border: 2px solid; border-radius: 3px; }
.tt-region span { position: absolute; top: -16px; left: -2px; font-size: 10px; color: #0a0a0a; padding: 1px 5px; border-radius: 3px; font-weight: 700; white-space: nowrap; }
.tt-divider { position: absolute; top: 0; bottom: 0; z-index: 4; width: 2px; background: #fff; transform: translateX(-1px); box-shadow: 0 0 6px rgba(0,0,0,0.6); }
.tt-wipe-row { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.tt-wipe { flex: 1; }
.tt-wipe-label { font-size: 12px; opacity: 0.7; min-width: 48px; }
.tt-wipe-label:last-child { text-align: right; }

.tt-tabs { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid var(--border-soft, #333); }
.tt-tabs button { background: none; border: none; color: inherit; padding: 9px 15px; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent; opacity: 0.7; }
.tt-tabs button.on { opacity: 1; border-bottom-color: var(--accent-strong); font-weight: 600; }

.tt-assetlist { margin: 0; padding-left: 20px; line-height: 1.9; font-size: 14px; }
.tt-code { background: #0d0d0d; border: 1px solid var(--border-soft, #2a2a2a); border-radius: 8px; padding: 14px; font-size: 12.5px; line-height: 1.6; overflow-x: auto; white-space: pre-wrap; word-break: break-word; font-family: var(--font-mono, monospace); }
.tt-inputgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.tt-inputcard { border: 1px solid var(--border-soft, #333); border-radius: 8px; padding: 12px; }
.tt-inputcard-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.tt-inputcard strong { display: block; margin-bottom: 4px; }

.tt-regen-controls { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
.tt-field { display: flex; flex-direction: column; gap: 5px; font-size: 13px; }
.tt-field > span { opacity: 0.8; }
.tt-field input, .tt-field select { background: #0d0d0d; border: 1px solid var(--border-soft, #333); border-radius: 7px; padding: 8px 10px; color: inherit; font-size: 14px; min-width: 220px; }
.tt-copyedits { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.tt-swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; }
.tt-regen-result { margin-top: 20px; }
`;
