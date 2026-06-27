"use client";

import { useEffect, useMemo, useState } from "react";

import type { DrainAdPreview, DrainStage, DrainStatus } from "@/lib/research/drain-status";

type LoadState = "idle" | "loading" | "error";

const REFRESH_MS = 15_000;

export function ResearchDrainDashboard({ initialStatus }: { initialStatus: DrainStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  async function refresh() {
    setLoadState("loading");
    try {
      const response = await fetch("/api/operator/research/drain-status", { cache: "no-store" });
      if (!response.ok) throw new Error(`status ${response.status}`);
      setStatus(await response.json() as DrainStatus);
      setError(null);
      setLoadState("idle");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Refresh failed");
      setLoadState("error");
    }
  }

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  const tone = status.overview.status === "ready"
    ? "ok"
    : status.overview.status === "attention"
      ? "bad"
      : status.overview.status === "first_fill_done"
        ? "warn"
        : "info";
  const paidCaptureTone = status.paidCapture.state === "ready" ? "ok" : "bad";
  const latestFetchAge = formatRelative(status.freshness.latestAdFetch?.completedAt ?? null, status.sampledAt);
  const latestIngestAge = formatRelative(status.freshness.latestIngest?.createdAt ?? null, status.sampledAt);

  return (
    <main className="drain">
      <style>{DRAIN_STYLES}</style>
      <header className="drain-top">
        <div>
          <p className="drain-kicker">Research drain</p>
          <h1>Ad DB first-fill monitor</h1>
        </div>
        <div className="drain-actions">
          <a className="drain-button" href="/operator/research">Research console</a>
          <button className="drain-button" type="button" onClick={() => setAutoRefresh((value) => !value)}>
            {autoRefresh ? "Auto refresh on" : "Auto refresh off"}
          </button>
          <button className="drain-button primary" type="button" onClick={() => void refresh()} disabled={loadState === "loading"}>
            {loadState === "loading" ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </header>

      <section className="drain-hero">
        <div className="drain-hero-main">
          <span className={`drain-pill ${tone}`}>{statusLabel(status.overview.status)}</span>
          <div className="drain-big-number">{status.overview.firstFillOpen.toLocaleString()}</div>
          <p>original first-fill jobs still open</p>
          <Progress value={status.overview.firstFillPercent} />
          <div className="drain-hero-meta">
            <span>{status.overview.firstFillPercent.toFixed(1)}% complete</span>
            <span>{status.overview.firstFillComplete.toLocaleString()} / {status.overview.firstFillTotal.toLocaleString()}</span>
            <span>{formatEta(status.overview.etaMinutes)}</span>
          </div>
        </div>
        <div className="drain-hero-side">
          <Metric label="live open gate" value={status.overview.liveOpen.toLocaleString()} />
          <Metric label="completed last hour" value={status.overview.firstFillCompletedLastHour.toLocaleString()} />
          <Metric label="failed / blocked" value={status.overview.failedBlocked.toLocaleString()} tone={status.overview.failedBlocked > 0 ? "bad" : "ok"} />
          <Metric label="sampled" value={formatClock(status.sampledAt)} />
        </div>
      </section>

      {error ? <div className="drain-alert">Dashboard refresh failed: {error}</div> : null}

      <section className="drain-grid four">
        {status.stages.map((stage) => <StageCard key={stage.key} stage={stage} />)}
      </section>

      <section className="drain-grid three">
        <Panel title="Freshness">
          <Metric label="active refresh policies" value={status.freshness.activePolicies.toLocaleString()} />
          <Metric label="policies stale over 24h" value={status.freshness.stalePolicies24h.toLocaleString()} tone={status.freshness.stalePolicies24h > 0 ? "warn" : "ok"} />
          <Metric label="ad pages due" value={status.freshness.stalePagesDue.toLocaleString()} />
          <Metric label="latest ingest" value={latestIngestAge} tone={ageTone(status.freshness.latestIngest?.createdAt ?? null, status.sampledAt, 10 * 60)} />
        </Panel>

        <Panel title="Paid Capture">
          <Metric label="paid capture circuit" value={status.paidCapture.state} tone={paidCaptureTone} />
          <Metric label="latest ad fetch" value={latestFetchAge} tone={ageTone(status.freshness.latestAdFetch?.completedAt ?? null, status.sampledAt, 2 * 60 * 60)} />
          <Metric label="cost 24h" value={`$${status.freshness.adFetchCost24hUsd.toFixed(4)}`} />
          <Metric label="per run cap" value={status.paidCapture.perRunCapUsd === null ? "n/a" : `$${status.paidCapture.perRunCapUsd.toFixed(2)}`} />
        </Panel>

        <Panel title="Location Search">
          <Metric label="pending" value={status.freshness.locationSearchOpen.pending.toLocaleString()} />
          <Metric label="claimed" value={status.freshness.locationSearchOpen.claimed.toLocaleString()} />
          <Metric label="failed / blocked" value={(status.freshness.locationSearchOpen.failed + status.freshness.locationSearchOpen.blocked).toLocaleString()} tone={status.freshness.locationSearchOpen.blocked > 0 ? "warn" : "ok"} />
          <p className="drain-note">Browser-search freshness is tracked separately from page-id refresh so it cannot hide first-fill progress.</p>
        </Panel>
      </section>

      <section className="drain-panel">
        <div className="drain-panel-head">
          <h2>Blocking Rows</h2>
          <span>{status.blockers.length}</span>
        </div>
        <table className="drain-table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {status.blockers.map((blocker) => (
              <tr key={blocker.id}>
                <td>{compactJobType(blocker.jobType)} <span>{shortId(blocker.id)}</span></td>
                <td><span className="drain-pill bad">{blocker.status}</span></td>
                <td>{blocker.reason ?? blocker.error ?? "unknown"}</td>
                <td>{formatRelative(blocker.updatedAt, status.sampledAt)}</td>
              </tr>
            ))}
            {status.blockers.length === 0 ? (
              <tr>
                <td colSpan={4}>No failed or blocked first-fill jobs.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <AdPreviewTable ads={status.adPreviews} sampledAt={status.sampledAt} />
    </main>
  );
}

function StageCard({ stage }: { stage: DrainStage }) {
  const firstFillOpen = stage.firstFill.pending + stage.firstFill.claimed + stage.firstFill.failed + stage.firstFill.blocked;
  const liveOpen = stage.live.pending + stage.live.claimed + stage.live.failed + stage.live.blocked;
  const trouble = stage.live.failed + stage.live.blocked;

  return (
    <section className="drain-card">
      <div className="drain-card-head">
        <h2>{stage.label}</h2>
        <span className={`drain-pill ${trouble > 0 ? "bad" : "ok"}`}>{trouble > 0 ? `${trouble} blocked` : "ok"}</span>
      </div>
      <div className="drain-card-number">{firstFillOpen.toLocaleString()}</div>
      <p>original open / {liveOpen.toLocaleString()} live open</p>
      <div className="drain-counts">
        <span>pending <b>{stage.live.pending}</b></span>
        <span>claimed <b>{stage.live.claimed}</b></span>
        <span>failed <b>{stage.live.failed}</b></span>
        <span>blocked <b>{stage.live.blocked}</b></span>
      </div>
      <p className="drain-note">{stage.firstFillCompletedLastHour.toLocaleString()} original jobs completed in the last hour.</p>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="drain-panel">
      <div className="drain-panel-head">
        <h2>{title}</h2>
      </div>
      <div className="drain-metric-list">{children}</div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" | "info" }) {
  return (
    <div className="drain-metric">
      <span>{label}</span>
      <b className={tone ? `tone-${tone}` : undefined}>{value}</b>
    </div>
  );
}

function AdPreviewTable({ ads, sampledAt }: { ads: DrainAdPreview[]; sampledAt: string }) {
  return (
    <section className="drain-panel drain-ad-panel">
      <div className="drain-panel-head">
        <div>
          <h2>Latest Ads</h2>
          <p className="drain-note">Recent saved ad cards with renderable media previews.</p>
        </div>
        <span>{ads.length}</span>
      </div>
      <div className="drain-ad-gridwrap">
        <table className="drain-table drain-ad-table">
          <thead>
            <tr>
              <th>Preview</th>
              <th>Advertiser</th>
              <th>Status</th>
              <th>Copy</th>
              <th>Area</th>
              <th>Last Seen</th>
              <th>Destination</th>
            </tr>
          </thead>
          <tbody>
            {ads.map((ad) => (
              <tr key={ad.id}>
                <td><AdMediaPreview ad={ad} /></td>
                <td>
                  <div className="drain-ad-primary">{ad.pageName}</div>
                  <div className="drain-ad-meta">{ad.libraryId ? `Library ${ad.libraryId}` : shortId(ad.id)}</div>
                </td>
                <td>
                  <span className={`drain-pill ${ad.activeStatus === "active" ? "ok" : ad.activeStatus === "inactive" ? "warn" : "info"}`}>
                    {ad.activeStatus}
                  </span>
                  {ad.platforms.length > 0 ? (
                    <div className="drain-ad-meta">{ad.platforms.slice(0, 2).join(", ")}</div>
                  ) : null}
                </td>
                <td>
                  <div className="drain-ad-copy">{ad.headline ?? ad.body ?? "No copy captured"}</div>
                  {ad.headline && ad.body ? <div className="drain-ad-meta">{ad.body}</div> : null}
                </td>
                <td>
                  <div>{[ad.suburb, ad.state].filter(Boolean).join(", ") || "Unknown"}</div>
                  {ad.postcode ? <div className="drain-ad-meta">{ad.postcode}</div> : null}
                </td>
                <td>
                  <div>{formatRelative(ad.lastSeenAt, sampledAt)}</div>
                  {ad.startedAt ? <div className="drain-ad-meta">started {formatRelative(ad.startedAt, sampledAt)}</div> : null}
                </td>
                <td>
                  {ad.destinationUrl ? (
                    <a className="drain-ad-link" href={ad.destinationUrl} target="_blank" rel="noreferrer">
                      {ad.destinationDomain ?? "Open"}
                    </a>
                  ) : (
                    <span className="drain-ad-meta">none</span>
                  )}
                </td>
              </tr>
            ))}
            {ads.length === 0 ? (
              <tr>
                <td colSpan={7}>No saved ads are available yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AdMediaPreview({ ad }: { ad: DrainAdPreview }) {
  const media = ad.media[0] ?? null;
  if (!media) {
    return (
      <div className="drain-ad-preview empty">
        <span>No media</span>
      </div>
    );
  }

  if (media.kind === "video") {
    return (
      <div className="drain-ad-preview">
        {media.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.posterUrl} alt="" loading="lazy" />
        ) : (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={media.url} muted preload="metadata" />
        )}
        <span className="drain-ad-video-badge">Video</span>
      </div>
    );
  }

  return (
    <div className="drain-ad-preview">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={media.url} alt="" loading="lazy" />
    </div>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <div className="drain-progress" aria-label={`${value}% complete`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function statusLabel(status: DrainStatus["overview"]["status"]) {
  if (status === "ready") return "ready for maintain";
  if (status === "first_fill_done") return "first fill done - live work remains";
  if (status === "attention") return "needs attention";
  return "draining";
}

function formatEta(minutes: number | null) {
  if (minutes === null) return "ETA needs more completions";
  if (minutes < 60) return `ETA ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `ETA ${hours}h ${rest}m` : `ETA ${hours}h`;
}

function formatClock(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatRelative(value: string | null, base: string) {
  if (!value) return "none";
  const seconds = Math.max(0, Math.round((new Date(base).getTime() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function ageTone(value: string | null, base: string, warnAfterSeconds: number): "ok" | "warn" | "bad" {
  if (!value) return "bad";
  const seconds = Math.max(0, Math.round((new Date(base).getTime() - new Date(value).getTime()) / 1000));
  if (seconds <= warnAfterSeconds) return "ok";
  if (seconds <= warnAfterSeconds * 2) return "warn";
  return "bad";
}

function compactJobType(value: string) {
  return value.replace(/^blockwise-/, "").replace(/-/gu, " ");
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;
}

const DRAIN_STYLES = `
.drain {
  min-height: 100vh;
  background: #f6f7f9;
  color: #17202c;
  padding: 22px;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.drain-top,
.drain-hero,
.drain-card,
.drain-panel {
  border: 1px solid #dfe5ec;
  background: #fff;
  border-radius: 8px;
}
.drain-top {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: center;
  padding: 16px 18px;
  margin-bottom: 14px;
}
.drain-kicker {
  margin: 0 0 4px;
  color: #687385;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}
.drain h1,
.drain h2,
.drain p {
  margin: 0;
}
.drain h1 {
  font-size: 24px;
  letter-spacing: 0;
}
.drain h2 {
  font-size: 14px;
}
.drain-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.drain-button {
  border: 1px solid #ccd6e0;
  background: #fff;
  color: #17202c;
  border-radius: 6px;
  padding: 8px 11px;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}
.drain-button.primary {
  border-color: #123e75;
  background: #123e75;
  color: #fff;
}
.drain-button:disabled {
  opacity: .55;
  cursor: wait;
}
.drain-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 18px;
  padding: 18px;
  margin-bottom: 14px;
}
.drain-hero-main p,
.drain-card p,
.drain-note {
  color: #687385;
  font-size: 13px;
}
.drain-big-number {
  margin-top: 10px;
  font-size: clamp(44px, 8vw, 88px);
  line-height: .92;
  font-weight: 800;
  letter-spacing: 0;
}
.drain-hero-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 9px;
  color: #687385;
  font-size: 12px;
  font-weight: 700;
}
.drain-hero-side,
.drain-metric-list {
  display: grid;
  gap: 10px;
}
.drain-grid {
  display: grid;
  gap: 14px;
  margin-bottom: 14px;
}
.drain-grid.four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.drain-grid.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.drain-card,
.drain-panel {
  padding: 14px;
}
.drain-card-head,
.drain-panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.drain-card-number {
  font-size: 34px;
  line-height: 1;
  font-weight: 800;
}
.drain-counts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin: 12px 0;
}
.drain-counts span,
.drain-metric {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid #edf1f5;
  background: #f9fafb;
  border-radius: 6px;
  padding: 8px 9px;
  color: #687385;
  font-size: 12px;
}
.drain-counts b,
.drain-metric b {
  color: #17202c;
  font-size: 13px;
}
.drain-progress {
  height: 10px;
  margin-top: 18px;
  background: #e8edf3;
  border-radius: 999px;
  overflow: hidden;
}
.drain-progress span {
  display: block;
  height: 100%;
  background: #0f7b60;
}
.drain-pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border: 1px solid #d8e0e8;
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  color: #4d5a69;
  background: #f8fafc;
}
.drain-pill.ok,
.tone-ok {
  color: #0f6b50 !important;
}
.drain-pill.warn,
.tone-warn {
  color: #9a5b00 !important;
}
.drain-pill.bad,
.tone-bad {
  color: #b42318 !important;
}
.drain-pill.info,
.tone-info {
  color: #123e75 !important;
}
.drain-alert {
  border: 1px solid #f0b5ae;
  background: #fff5f4;
  color: #9b1c12;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 14px;
  font-size: 13px;
}
.drain-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.drain-table th,
.drain-table td {
  border-top: 1px solid #edf1f5;
  padding: 10px 8px;
  text-align: left;
  vertical-align: top;
}
.drain-table th {
  color: #687385;
  font-size: 11px;
  text-transform: uppercase;
}
.drain-table td span {
  color: #8a95a5;
}
.drain-ad-panel {
  margin-top: 14px;
}
.drain-ad-gridwrap {
  overflow: auto;
  border: 1px solid #edf1f5;
  border-radius: 6px;
  max-height: 620px;
}
.drain-ad-table {
  min-width: 1080px;
  font-size: 12.5px;
}
.drain-ad-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f9fafb;
  border-top: 0;
}
.drain-ad-table td {
  max-width: 320px;
}
.drain-ad-primary {
  color: #17202c;
  font-weight: 800;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drain-ad-meta {
  margin-top: 3px;
  color: #778396;
  font-size: 11.5px;
  line-height: 1.35;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.drain-ad-copy {
  color: #17202c;
  font-weight: 700;
  line-height: 1.35;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.drain-ad-link {
  color: #123e75;
  font-weight: 800;
  text-decoration: none;
}
.drain-ad-link:hover {
  text-decoration: underline;
}
.drain-ad-preview {
  position: relative;
  width: 72px;
  height: 72px;
  border: 1px solid #dfe5ec;
  border-radius: 6px;
  background: #eef2f6;
  overflow: hidden;
  display: grid;
  place-items: center;
}
.drain-ad-preview img,
.drain-ad-preview video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
.drain-ad-preview.empty {
  color: #778396;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}
.drain-ad-video-badge {
  position: absolute;
  right: 5px;
  bottom: 5px;
  border-radius: 4px;
  background: rgba(23, 32, 44, .82);
  color: #fff !important;
  font-size: 10px;
  font-weight: 800;
  padding: 2px 5px;
  text-transform: uppercase;
}
@media (max-width: 1000px) {
  .drain-hero,
  .drain-grid.four,
  .drain-grid.three {
    grid-template-columns: 1fr;
  }
  .drain-top {
    align-items: flex-start;
    flex-direction: column;
  }
  .drain-actions {
    justify-content: flex-start;
  }
}
`;
