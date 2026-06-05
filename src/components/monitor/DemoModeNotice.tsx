"use client";

import { ChartNoAxesCombined, Plug, Radar, X } from "lucide-react";
import { useEffect, useState } from "react";

const DISMISS_KEY = "bw-results-setup-dismissed";

/**
 * Shown on Results while the workspace has no Meta connection and the
 * dashboard is filled with demo data. Renders:
 *  1. A persistent banner labelling everything below as demo data.
 *  2. A one-time welcome popup that guides the user to connect.
 * Both disappear automatically once Meta is connected (the server stops
 * sending demo payloads, so this component is simply never rendered).
 */
export function DemoModeNotice({ metaConnectHref }: { metaConnectHref: string }) {
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISS_KEY) !== "true") {
        setShowGuide(true);
      }
    } catch {
      setShowGuide(true);
    }
  }, []);

  function dismissGuide() {
    setShowGuide(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // localStorage unavailable — popup just reappears next visit.
    }
  }

  return (
    <>
      <section className="mm-demo-banner" aria-live="polite">
        <div className="mm-demo-banner-text">
          <strong>You&apos;re looking at demo data.</strong>
          <span>
            Connect your Meta ad account and your real spend, leads, and ads replace this instantly.
          </span>
        </div>
        <div className="mm-demo-banner-actions">
          <a className="button" href={metaConnectHref}>
            <Plug aria-hidden size={14} />
            Connect Meta
          </a>
          <button className="button secondary" type="button" onClick={() => setShowGuide(true)}>
            Setup guide
          </button>
        </div>
      </section>

      {showGuide ? (
        <div className="mm-guide-overlay" role="presentation" onClick={dismissGuide}>
          <div
            className="mm-guide-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mm-guide-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="mm-guide-close" type="button" aria-label="Close setup guide" onClick={dismissGuide}>
              <X aria-hidden size={16} />
            </button>
            <h2 id="mm-guide-title">Welcome to Blockwise</h2>
            <p className="mm-guide-sub">
              Everything on this page is <strong>demo data</strong> — a preview of what Results looks like once your
              ads are running. Getting set up takes about a minute.
            </p>
            <ol className="mm-guide-steps">
              <li>
                <span className="mm-guide-step-ic">
                  <Plug aria-hidden size={16} />
                </span>
                <div>
                  <strong>Connect your Meta ad account</strong>
                  <p>The demo data is dropped the moment you connect — only your real results are shown.</p>
                </div>
              </li>
              <li>
                <span className="mm-guide-step-ic">
                  <ChartNoAxesCombined aria-hidden size={16} />
                </span>
                <div>
                  <strong>Watch Results fill with your numbers</strong>
                  <p>Spend, leads, cost per lead, and ad-by-ad performance — updated automatically.</p>
                </div>
              </li>
              <li>
                <span className="mm-guide-step-ic">
                  <Radar aria-hidden size={16} />
                </span>
                <div>
                  <strong>Spy on competitors in Ad Radar</strong>
                  <p>See the real ads other agencies are running in your postcodes right now.</p>
                </div>
              </li>
            </ol>
            <div className="mm-guide-actions">
              <a className="button" href={metaConnectHref}>
                Connect Meta
              </a>
              <button className="button secondary" type="button" onClick={dismissGuide}>
                Explore the demo first
              </button>
            </div>
            <p className="mm-guide-note">
              You can connect any time from <a href="/settings">Settings</a>.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
