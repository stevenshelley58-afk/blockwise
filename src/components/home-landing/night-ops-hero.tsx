import { CountUp } from "@/components/motion";

import { SuburbReportLocationForm } from "./suburb-report-location-form";

import "./night-ops-hero.css";

/* Suburb boundary traced from the actual glowing outline baked into the map
   asset (sampled pixel-by-pixel in the map's 1376×768 space), so the animated
   overlay sits exactly on the street-following boundary at every viewport
   size. The SVG uses preserveAspectRatio="xMidYMid slice" — the SVG equivalent
   of the map's object-fit:cover — so it crops/scales identically to the image. */
const BOUNDARY_D =
  "M266 402 L324 316 L322 278 L282 254 L368 254 L428 246 L422 122 L428 118 L504 74 L566 82 L604 88 L638 94 L668 98 L696 102 L722 106 L754 110 L796 116 L824 120 L850 124 L876 128 L908 134 L940 138 L1036 168 L1180 146 L1190 208 L1188 220 L1162 272 L1148 316 L1162 386 L1198 422 L1184 428 L1144 462 L1144 520 L1132 540 L1116 570 L1094 634 L1108 668 L1064 660 L998 682 L986 698 L954 694 L912 686 L876 680 L838 678 L816 670 L772 670 L768 662 L744 658 L718 654 L682 648 L678 650 L648 644 L616 636 L600 640 L566 628 L536 624 L506 618 L470 618 L426 604 L368 608 L308 586 L246 574 L250 558 L240 492 L264 468 Z";

/* ---------- #top — Night Ops hero (dark map fold) ----------
   The suburb boundary is baked into the map asset so it follows the real
   street grid (reads as an actual selected suburb). An SVG overlay re-traces
   that exact boundary on a loop: draw the outline → fill the area → fade out.
   Copy + working suburb search sit left; illustrative metric cards float
   right. */
export function NightOpsHero() {
  return (
    <div className="hw-no">
      <img
        className="hw-no-map"
        src="/home/night-ops-map.webp"
        alt=""
        aria-hidden
        fetchPriority="high"
      />
      <div className="hw-no-scrim" aria-hidden />
      <svg
        className="hw-no-boundary"
        viewBox="0 0 1376 768"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <path className="hw-no-boundary-fill" d={BOUNDARY_D} />
        {/* Soft bloom: blurred full outline, opacity-only animation (composited
            safely). Kept separate from the traced core so the draw-on dash
            animation never shares a layer with a filter — which can freeze it. */}
        <path className="hw-no-boundary-glow" d={BOUNDARY_D} />
        {/* Crisp tracing core: no filter, so the stroke-dashoffset draw always
            repaints. Bright core reads over the baked blue boundary. */}
        <path className="hw-no-boundary-stroke" d={BOUNDARY_D} pathLength={1} />
      </svg>

      <div className="hw-no-content">
        <h1 className="hw-no-h1">
          Your competitors are
          <br />
          advertising.
          <br />
          <span className="hw-no-accent">Are you?</span>
        </h1>
        <p className="hw-no-lede">Meta ads built from what works in your suburb.</p>
        {/* Mobile showcase: the suburb-framed map crop with the full boundary
            visible (the desktop backdrop crops to a narrow slice on portrait).
            The SVG uses the crop's viewBox so the trace stays aligned. */}
        <picture className="hw-no-showcase" aria-hidden>
          <img
            src="/home/night-ops-map-mobile.webp"
            alt=""
            width={832}
            height={541}
            fetchPriority="high"
            decoding="async"
          />
          <svg
            className="hw-no-boundary"
            viewBox="190 40 1058 688"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden
          >
            <path className="hw-no-boundary-fill" d={BOUNDARY_D} />
            <path className="hw-no-boundary-glow" d={BOUNDARY_D} />
            <path className="hw-no-boundary-stroke" d={BOUNDARY_D} pathLength={1} />
          </svg>
        </picture>
        <div className="hw-no-form">
          <SuburbReportLocationForm analyticsLocation="hero" />
        </div>
      </div>

      <div className="hw-no-cards" aria-hidden>
        <span className="hw-no-examples">Examples</span>
        <div className="hw-no-card hw-no-card--1">
          <p className="hw-no-card-k">Ads collected</p>
          <p className="hw-no-card-v">
            <CountUp to={1240} />
          </p>
          <p className="hw-no-card-s">tracked all time</p>
        </div>
        <div className="hw-no-card hw-no-card--2">
          <p className="hw-no-card-k">Live now</p>
          <p className="hw-no-card-v">
            <CountUp to={27} />
          </p>
          <p className="hw-no-card-s">running this week</p>
        </div>
        <div className="hw-no-card hw-no-card--3">
          <p className="hw-no-card-k">Top angle</p>
          <p className="hw-no-card-v hw-no-card-v--text">Free appraisal</p>
          <p className="hw-no-card-s">used by 9 of 27 campaigns</p>
        </div>
      </div>

      <div className="hw-no-stats" aria-hidden>
        <span className="hw-no-examples hw-no-examples--strip">Examples</span>
        <div className="hw-no-stat">
          <span className="hw-no-stat-v">
            <CountUp to={1240} />
          </span>
          <span className="hw-no-stat-k">Ads tracked</span>
        </div>
        <div className="hw-no-stat">
          <span className="hw-no-stat-v">
            <CountUp to={27} />
          </span>
          <span className="hw-no-stat-k">Live now</span>
        </div>
        <div className="hw-no-stat">
          <span className="hw-no-stat-v hw-no-stat-v--text">Free appraisal</span>
          <span className="hw-no-stat-k">Top angle</span>
        </div>
      </div>
    </div>
  );
}
