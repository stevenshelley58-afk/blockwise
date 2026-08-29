import Image from "next/image";

import { CtaLink } from "@/components/landing/cta-link";

import "./workspace-hero.css";

const GRAPH_LINE =
  "M4 106 C44 104 63 84 104 82 C140 80 162 95 199 93 C238 91 250 53 292 53 C330 53 340 66 377 61 C414 56 424 25 465 27 C495 29 514 38 548 19";

function MetaAd({
  className,
  imageSrc,
  headline,
  label,
}: {
  className: string;
  imageSrc: string;
  headline: string;
  label: string;
}) {
  return (
    <div className={`hw-ws-ad ${className}`}>
      <div className="hw-ws-ad__account">
        <span className="hw-ws-ad__avatar">YA</span>
        <span>
          <strong>Your Agency</strong>
          <small>Sponsored</small>
        </span>
      </div>
      <div className="hw-ws-ad__image">
        <Image src={imageSrc} alt="" fill sizes="220px" priority />
        <strong>{headline}</strong>
      </div>
      <div className="hw-ws-ad__footer">
        <span>
          <small>YOURAGENCY.COM.AU</small>
          <strong>{label}</strong>
        </span>
        <b>Learn more</b>
      </div>
    </div>
  );
}

/**
 * THESIS: Blockwise is the advertising workspace itself, not a category metaphor.
 * OWN-WORLD: Obsidian work surface, white Manrope display, one data-blue voice.
 * STORY: See the product, understand create/approve/track, then start a free trial.
 * FIRST VIEWPORT: Exact challenge copy left; live-feeling campaign workspace right.
 * FORM: User-approved 06A comp, reproduced as a responsive product proof hero.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
 */
export function WorkspaceHero() {
  return (
    <div className="hw-ws">
      <div className="hw-ws__grid" aria-hidden />
      <div className="hw-wide hw-ws__inner">
        <div className="hw-ws__copy">
          <p className="hw-ws__eyebrow">The real estate advertising workspace</p>
          <h1 className="hw-ws__title">
            Your competitors are advertising. <span>Are you?</span>
          </h1>
          <p className="hw-ws__lede">
            Create, approve and track Meta ads from one beautifully simple workspace.
          </p>
          <CtaLink location="hero" href="/signup" className="hw-btn hw-btn--light hw-ws__cta">
            Start free trial <span aria-hidden>→</span>
          </CtaLink>
        </div>

        <div className="hw-ws-product" aria-hidden>
          <div className="hw-ws-product__bar">
            <span className="hw-ws-product__dots"><i /><i /><i /></span>
            <span>Blockwise / Campaigns</span>
            <b>Example campaign</b>
          </div>
          <div className="hw-ws-product__body">
            <div className="hw-ws-product__nav">
              <span className="hw-ws-product__nav-logo" />
              <i className="is-active" />
              <i />
              <i />
              <i />
            </div>

            <div className="hw-ws-product__main">
              <div className="hw-ws-product__heading">
                <strong>Performance</strong>
                <span>Create campaign</span>
              </div>
              <div className="hw-ws-metrics">
                <div><small>Leads</small><strong>35</strong></div>
                <div><small>Cost / lead</small><strong>$18</strong></div>
                <div><small>Clicks</small><strong>522</strong></div>
              </div>
              <div className="hw-ws-graph">
                <svg viewBox="0 0 552 124" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="workspaceGraphFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#2a78d6" stopOpacity=".42" />
                      <stop offset="1" stopColor="#2a78d6" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path className="hw-ws-graph__fill" d={`${GRAPH_LINE} L548 124 L4 124 Z`} />
                  <path className="hw-ws-graph__line" d={GRAPH_LINE} pathLength="1" />
                </svg>
              </div>
              <div className="hw-ws-campaigns">
                <div><span>Mt Lawley appraisal</span><b>Active</b><strong>18</strong></div>
                <div><span>Subiaco seller campaign</span><b>Active</b><strong>11</strong></div>
              </div>
            </div>

            <div className="hw-ws-product__ads">
              <div className="hw-ws-product__ads-head"><strong>Prepared ads</strong><small>Feed preview</small></div>
              <MetaAd
                className="hw-ws-ad--home"
                imageSrc="/home/workspace-hero/home-ad.png"
                headline="WHAT IS YOUR HOME WORTH?"
                label="Free appraisal"
              />
              <MetaAd
                className="hw-ws-ad--agent"
                imageSrc="/home/workspace-hero/agent-ad.png"
                headline="YOUR LOCAL PROPERTY EXPERT"
                label="Seller consult"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
