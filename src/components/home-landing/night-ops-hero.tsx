import { getImageProps } from "next/image";

import { CtaLink } from "@/components/landing/cta-link";

import "./night-ops-hero.css";

/* Suburb boundary traced from the actual glowing outline baked into the map
   asset (sampled pixel-by-pixel in the map's 1376×768 space), so the animated
   overlay sits exactly on the street-following boundary at every viewport
   size. The SVG uses preserveAspectRatio="xMidYMid slice" — the SVG equivalent
   of the map's object-fit:cover — so it crops/scales identically to the image. */
const BOUNDARY_D =
  "M266 402 L324 316 L322 278 L282 254 L368 254 L428 246 L422 122 L428 118 L504 74 L566 82 L604 88 L638 94 L668 98 L696 102 L722 106 L754 110 L796 116 L824 120 L850 124 L876 128 L908 134 L940 138 L1036 168 L1180 146 L1190 208 L1188 220 L1162 272 L1148 316 L1162 386 L1198 422 L1184 428 L1144 462 L1144 520 L1132 540 L1116 570 L1094 634 L1108 668 L1064 660 L998 682 L986 698 L954 694 L912 686 L876 680 L838 678 L816 670 L772 670 L768 662 L744 658 L718 654 L682 648 L678 650 L648 644 L616 636 L600 640 L566 628 L536 624 L506 618 L470 618 L426 604 L368 608 L308 586 L246 574 L250 558 L240 492 L264 468 Z";

const { props: desktopMapProps } = getImageProps({
  alt: "",
  src: "/home/night-ops-map.webp",
  width: 1376,
  height: 768,
  sizes: "100vw",
  priority: true,
});

const { props: mobileMapProps } = getImageProps({
  alt: "",
  src: "/home/night-ops-map-mobile-full.webp",
  width: 941,
  height: 1672,
  sizes: "100vw",
  priority: true,
});

/* ---------- #top — Night Ops hero (dark map fold) ----------
   The suburb boundary is baked into the map asset so it follows the real
   street grid (reads as an actual selected suburb). An SVG overlay re-traces
   that exact boundary on a loop: draw the outline → fill the area → fade out.
   Copy + signup CTA sit left; one operational receipt proves the workflow. */
export function NightOpsHero() {
  return (
    <div className="hw-no">
      <picture className="hw-no-map" aria-hidden>
        <source media="(max-width: 959.98px)" srcSet={mobileMapProps.srcSet} />
        <img {...desktopMapProps} alt="" />
      </picture>
      <div className="hw-no-scrim" aria-hidden />
      <svg
        className="hw-no-boundary hw-no-boundary--desktop"
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
      <svg
        className="hw-no-boundary hw-no-boundary--mobile"
        viewBox="0 0 941 1672"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <g transform="translate(0 519) scale(0.683866279)">
          <path className="hw-no-boundary-fill" d={BOUNDARY_D} />
          <path className="hw-no-boundary-glow" d={BOUNDARY_D} />
          <path
            className="hw-no-boundary-stroke"
            d={BOUNDARY_D}
            pathLength={1}
          />
        </g>
      </svg>

      <div className="hw-no-content">
        <h1 className="hw-no-h1">
          Your competitors are
          <br />
          advertising.
          <br />
          <span className="hw-no-accent">Are you?</span>
        </h1>
        <p className="hw-no-lede">
          Generate more leads with high-quality templates, personalised AI copy and simple
          publishing. No more wrestling with Meta Ads Manager.
        </p>
        <div className="hw-no-form">
          <CtaLink location="hero" href="/signup" className="hw-btn hw-btn--dark hw-no-cta">
            Create three ads free <span className="hw-arr">→</span>
          </CtaLink>
          <p className="hw-no-note">Email only. No card.</p>
        </div>
      </div>

      <aside className="hw-no-proof" aria-label="Example ad pack status">
        <div className="hw-no-proof-head">
          <span>Ad pack · example</span>
          <strong>Ready for review</strong>
        </div>
        <h2>Free appraisal campaign</h2>
        <p>One complete pack, prepared before anything can spend.</p>
        <dl>
          <div><dt>Creative</dt><dd>Feed + Story</dd></div>
          <div><dt>Copy</dt><dd>Personalised</dd></div>
          <div><dt>Publish</dt><dd>Approval required</dd></div>
        </dl>
        <div className="hw-no-proof-foot"><span aria-hidden>✓</span> Nothing spends before approval</div>
      </aside>
    </div>
  );
}
