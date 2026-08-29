import { SuburbReportLocationForm } from "@/components/home-landing/suburb-report-location-form";

import { CountUp, InView, ParallaxField } from "@/components/motion";

/* Shared suburb-boundary geometry (drawn in a 1376×768 space to match the map
   assets). Heroes that draw their own boundary/pins use these so the overlay
   reads as one coherent "scanned suburb" across variants. The outline is a
   realistic coastal suburb: smooth organic curves with a prominent bay on the
   east side and irregular lobes, so it reads as a real selected suburb rather
   than a bubble or a jagged crystal. */
const BOUNDARY_D =
  "M425 205 C465 172 512 162 555 178 C596 193 628 168 672 158 C718 147 758 163 795 155 C833 147 868 168 900 162 C940 155 972 185 992 222 C1012 260 1024 302 1010 342 C999 373 1010 402 1026 436 C1040 468 1030 496 998 508 C958 523 920 515 894 540 C868 566 888 592 926 602 C964 612 986 636 972 664 C956 694 916 704 878 696 C840 688 810 702 770 697 C730 692 700 707 660 700 C620 693 590 707 550 697 C510 687 480 699 442 685 C404 671 376 645 356 609 C336 573 340 535 328 499 C316 463 326 427 314 391 C302 355 312 319 300 283 C289 249 302 219 332 204 C358 191 398 212 425 205 Z";

const PINS = [
  { x: 620, y: 300 },
  { x: 845, y: 285 },
  { x: 560, y: 445 },
  { x: 770, y: 470 },
  { x: 900, y: 400 },
];
const MAIN_PIN = { x: 705, y: 380 };

/* ================================================================
   V1 · RADAR SWEEP
   Full-bleed clean map, dark left scrim, a rotating radar beam and
   pulsing rings centred on a CSS pin. Staggered word reveal headline.
   ================================================================ */
export function HeroRadarSweep() {
  return (
    <InView className="hl-hero hl-v1" threshold={0.2}>
      <img
        className="hl-v1-map"
        src="/hero-lab/map-clean.webp"
        alt=""
        aria-hidden
        fetchPriority="high"
      />
      <div className="hl-v1-scrim" aria-hidden />
      {/* radar beam + pin + rings, centred on one point */}
      <div className="hl-v1-radar" aria-hidden>
        <div className="hl-v1-sweep" />
        <div className="hl-v1-ring hl-v1-ring--1" />
        <div className="hl-v1-ring hl-v1-ring--2" />
        <div className="hl-v1-ring hl-v1-ring--3" />
        <div className="hl-v1-pin">
          <span className="hl-v1-pin-core" />
        </div>
      </div>

      <div className="hl-v1-content">
        <p className="hl-v1-eyebrow">
          <span className="hl-v1-eyebrow-dot" aria-hidden />
          Ad radar · scanning your suburb
        </p>
        <h2 className="hl-v1-h1">
          <span className="hl-v1-line">Your competitors</span>
          <span className="hl-v1-line">are advertising.</span>
          <span className="hl-v1-line hl-v1-line--accent">Are you?</span>
        </h2>
        <p className="hl-v1-lede">
          Every Meta ad running near your listings, found and ranked. See what
          is working before you spend a dollar.
        </p>
        <div className="hl-v1-form">
          <SuburbReportLocationForm analyticsLocation="hero_lab_radar" />
        </div>
      </div>

      <p className="hl-v1-plate">Illustrative map · Joondalup, WA</p>
    </InView>
  );
}

/* ================================================================
   V2 · BOUNDARY DRAW
   Split layout. Copy + form left; right panel is the clean map with
   an SVG suburb boundary that draws itself in, pins that pop, and a
   floating live chip. Count-up proof row under the form.
   ================================================================ */
export function HeroBoundaryDraw() {
  return (
    <InView className="hl-hero hl-v2" threshold={0.2}>
      <div className="hl-v2-grid">
        <div className="hl-v2-copy">
          <p className="hl-eyebrow hl-v2-eyebrow">Ad radar</p>
          <h2 className="hl-v2-h1">
            See every competitor ad in your suburb.
          </h2>
          <p className="hl-lede hl-v2-lede">
            Type a suburb and Blockwise draws the boundary around every active
            Meta ad inside it — creative, angle, and who is paying to run it.
          </p>
          <div className="hl-v2-form">
            <SuburbReportLocationForm analyticsLocation="hero_lab_boundary" />
          </div>
          <dl className="hl-v2-stats">
            <div className="hl-v2-stat">
              <dt>Ads indexed</dt>
              <dd>
                <CountUp to={10000} suffix="+" />
              </dd>
            </div>
            <div className="hl-v2-stat">
              <dt>Refresh</dt>
              <dd>Daily</dd>
            </div>
            <div className="hl-v2-stat">
              <dt>Suburb report</dt>
              <dd>Free</dd>
            </div>
          </dl>
        </div>

        <div className="hl-v2-panel">
          <img
            className="hl-v2-map"
            src="/hero-lab/map-clean.webp"
            alt=""
            aria-hidden
            loading="lazy"
          />
          <svg
            className="hl-v2-svg"
            viewBox="0 0 1376 768"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden
          >
            <path className="hl-v2-fill" d={BOUNDARY_D} pathLength={1} />
            <path className="hl-v2-stroke" d={BOUNDARY_D} pathLength={1} />
            {PINS.map((pin, i) => (
              <circle
                key={`${pin.x}-${pin.y}`}
                className="hl-v2-dot"
                style={{ animationDelay: `${1.35 + i * 0.12}s` }}
                cx={pin.x}
                cy={pin.y}
                r={7}
              />
            ))}
            <g className="hl-v2-main">
              <circle className="hl-v2-main-ring" cx={MAIN_PIN.x} cy={MAIN_PIN.y} r={26} />
              <circle className="hl-v2-main-dot" cx={MAIN_PIN.x} cy={MAIN_PIN.y} r={11} />
            </g>
          </svg>
          <div className="hl-v2-chip">
            <span className="hl-v2-chip-dot" aria-hidden />
            <span>
              <strong>27 active ads</strong> · Joondalup 6027
            </span>
          </div>
        </div>
      </div>
    </InView>
  );
}

/* ================================================================
   V3 · NIGHT OPS
   Full-bleed dark map. Glass intelligence cards with count-up
   metrics rise over the map; copy + form sit on a dark plate left.
   ================================================================ */
export function HeroNightOps() {
  return (
    <InView className="hl-hero hl-v3" threshold={0.2}>
      <img
        className="hl-v3-map"
        src="/hero-lab/map-dark.webp"
        alt=""
        aria-hidden
        loading="lazy"
      />
      <div className="hl-v3-scrim" aria-hidden />

      <div className="hl-v3-content">
        <h2 className="hl-v3-h1">
          Your competitors are
          <br />
          advertising.
          <br />
          <span className="hl-accent">Are you?</span>
        </h2>
        <div className="hl-v3-form">
          <SuburbReportLocationForm analyticsLocation="hero_lab_night" />
        </div>
      </div>

      <div className="hl-v3-cards" aria-hidden>
        <div className="hl-v3-card hl-v3-card--1">
          <p className="hl-v3-card-k">Ads collected</p>
          <p className="hl-v3-card-v">
            <CountUp to={1240} />
          </p>
          <p className="hl-v3-card-s">tracked all time</p>
        </div>
        <div className="hl-v3-card hl-v3-card--2">
          <p className="hl-v3-card-k">Live now</p>
          <p className="hl-v3-card-v">
            <CountUp to={27} />
          </p>
          <p className="hl-v3-card-s">running this week</p>
        </div>
        <div className="hl-v3-card hl-v3-card--3">
          <p className="hl-v3-card-k">Top angle</p>
          <p className="hl-v3-card-v hl-v3-card-v--text">Free appraisal</p>
          <p className="hl-v3-card-s">used by 9 of 27 campaigns</p>
        </div>
      </div>

      <p className="hl-v3-plate">Illustrative data · Perth metro</p>
    </InView>
  );
}

/* ================================================================
   V4 · DEPTH FIELD
   Full-bleed parallax. The map recedes, the boundary sits mid-depth,
   pins and a floating ad chip come forward as the pointer moves.
   ================================================================ */
export function HeroDepthField() {
  return (
    <InView className="hl-hero hl-v4" threshold={0.15}>
      <ParallaxField className="hl-v4-field">
        <div className="hl-v4-layer hl-v4-layer--map" data-depth="-16">
          <img
            className="hl-v4-map"
            src="/hero-lab/map-clean.webp"
            alt=""
            aria-hidden
            loading="lazy"
          />
        </div>
        <div className="hl-v4-scrim" aria-hidden />
        <div className="hl-v4-layer hl-v4-layer--boundary" data-depth="10">
          <svg
            className="hl-v4-svg"
            viewBox="0 0 1376 768"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden
          >
            <path className="hl-v4-fill" d={BOUNDARY_D} />
            <path className="hl-v4-stroke" d={BOUNDARY_D} />
          </svg>
        </div>
        <div className="hl-v4-layer hl-v4-layer--pins" data-depth="26">
          <svg
            className="hl-v4-svg"
            viewBox="0 0 1376 768"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden
          >
            {PINS.map((pin) => (
              <circle
                key={`${pin.x}-${pin.y}`}
                className="hl-v4-dot"
                cx={pin.x}
                cy={pin.y}
                r={7}
              />
            ))}
            <circle className="hl-v4-main-ring" cx={MAIN_PIN.x} cy={MAIN_PIN.y} r={24} />
            <circle className="hl-v4-main-dot" cx={MAIN_PIN.x} cy={MAIN_PIN.y} r={10} />
          </svg>
        </div>
        <div className="hl-v4-layer hl-v4-layer--chip" data-depth="40">
          <div className="hl-v4-chip">
            <span className="hl-v4-chip-dot" aria-hidden />
            <span>
              <strong>Seller-lead ad</strong> spotted · 2 min ago
            </span>
          </div>
        </div>
      </ParallaxField>

      <div className="hl-v4-content">
        <p className="hl-eyebrow hl-v4-eyebrow">Ad radar</p>
        <h2 className="hl-v4-h1">
          The ads your sellers see.
          <br />
          Now you can see them too.
        </h2>
        <p className="hl-lede hl-v4-lede">
          A live map of competitor creative in your suburb — so your next
          listing ad starts from evidence, not guesswork.
        </p>
        <div className="hl-v4-form">
          <SuburbReportLocationForm analyticsLocation="hero_lab_depth" />
        </div>
      </div>
    </InView>
  );
}

/* ================================================================
   V5 · CINEMATIC
   Full-viewport map (with baked boundary) on a slow Ken Burns zoom.
   Centreed copy with a mask-reveal headline, centred form, scroll cue.
   ================================================================ */
export function HeroCinematic() {
  return (
    <InView className="hl-hero hl-v5" threshold={0.2}>
      <img
        className="hl-v5-map"
        src="/hero-lab/map-light.webp"
        alt=""
        aria-hidden
        loading="lazy"
      />
      <div className="hl-v5-scrim" aria-hidden />
      <div className="hl-v5-vignette" aria-hidden />

      <div className="hl-v5-content">
        <p className="hl-v5-eyebrow">Blockwise · Ad radar for real estate</p>
        <h2 className="hl-v5-h1">
          <span className="hl-v5-mask">
            <span className="hl-v5-mask-inner">Your competitors are</span>
          </span>
          <span className="hl-v5-mask">
            <span className="hl-v5-mask-inner hl-v5-mask-inner--accent">
              advertising. Are you?
            </span>
          </span>
        </h2>
        <p className="hl-v5-lede">
          One suburb report shows you every competitor ad running near your
          listings — free, in about a minute.
        </p>
        <div className="hl-v5-form">
          <SuburbReportLocationForm analyticsLocation="hero_lab_cinematic" />
        </div>
      </div>

      <div className="hl-v5-scrollcue" aria-hidden>
        <span className="hl-v5-scrollcue-line" />
        <span>Scroll</span>
      </div>
    </InView>
  );
}
