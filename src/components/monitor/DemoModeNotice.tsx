"use client";

import { ChartNoAxesCombined, Plug, Radar, X } from "lucide-react";
import { useEffect, useState } from "react";

const BANNER_HIDE_KEY = "bw-results-demo-banner-hidden";

/**
 * Shown on Results while the workspace has no Meta connection and the
 * dashboard is filled with demo data. The full notice can be hidden into a
 * small strip; everything disappears automatically once Meta is connected.
 */
export function DemoModeNotice({ metaConnectHref }: { metaConnectHref: string }) {
  const [showGuide, setShowGuide] = useState(false);
  const [bannerHidden, setBannerHidden] = useState(false);

  useEffect(() => {
    try {
      setBannerHidden(window.localStorage.getItem(BANNER_HIDE_KEY) === "true");
    } catch {
      setBannerHidden(false);
    }
  }, []);

  function hideBanner() {
    setBannerHidden(true);
    try {
      window.localStorage.setItem(BANNER_HIDE_KEY, "true");
    } catch {
      // Ignore unavailable storage; the in-session state is enough.
    }
  }

  function showBanner() {
    setBannerHidden(false);
    try {
      window.localStorage.removeItem(BANNER_HIDE_KEY);
    } catch {
      // Ignore unavailable storage; the in-session state is enough.
    }
  }

  const guideDialog = showGuide ? (
    <div className="mm-guide-overlay" role="presentation" onClick={() => setShowGuide(false)}>
      <div
        className="mm-guide-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mm-guide-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="mm-guide-close" type="button" aria-label="Close setup guide" onClick={() => setShowGuide(false)}>
          <X aria-hidden size={16} />
        </button>
        <h2 id="mm-guide-title">Welcome to Blockwise</h2>
        <p className="mm-guide-sub">
          Everything on this page is <strong>demo data</strong> - a preview of what Results looks like once your
          ads are running. Getting set up takes about a minute.
        </p>
        <ol className="mm-guide-steps">
          <li>
            <span className="mm-guide-step-ic">
              <Plug aria-hidden size={16} />
            </span>
            <div>
              <strong>Connect your Meta ad account</strong>
              <p>The demo data is dropped the moment you connect - only your real results are shown.</p>
            </div>
          </li>
          <li>
            <span className="mm-guide-step-ic">
              <ChartNoAxesCombined aria-hidden size={16} />
            </span>
            <div>
              <strong>Watch Results fill with your numbers</strong>
              <p>Spend, leads, cost per lead, and ad-by-ad performance - updated automatically.</p>
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
          <button className="button secondary" type="button" onClick={() => setShowGuide(false)}>
            Explore the demo first
          </button>
        </div>
        <p className="mm-guide-note">
          You can connect any time from <a href="/settings">Settings</a>.
        </p>
      </div>
    </div>
  ) : null;

  return (
    <>
      {bannerHidden ? (
        <section className="mm-demo-peek" aria-live="polite">
          <span>
            <span className="mm-demo-peek-dot" aria-hidden />
            Demo data
          </span>
          <div className="mm-demo-peek-actions">
            <a href={metaConnectHref}>Connect Meta</a>
            <button type="button" onClick={showBanner}>Show</button>
          </div>
        </section>
      ) : (
        <section className="mm-demo-banner" aria-live="polite">
          <div className="mm-demo-banner-text">
            <strong>Demo data</strong>
            <span>Connect Meta to replace it with your real spend, leads, and ads.</span>
          </div>
          <div className="mm-demo-banner-actions">
            <a className="button" href={metaConnectHref}>
              <Plug aria-hidden size={14} />
              Connect Meta
            </a>
            <button className="button secondary" type="button" onClick={() => setShowGuide(true)}>
              Setup guide
            </button>
            <button className="mm-demo-banner-hide" type="button" aria-label="Hide demo data notice" onClick={hideBanner}>
              <X aria-hidden size={14} />
              Hide
            </button>
          </div>
        </section>
      )}

      {guideDialog}
    </>
  );
}
