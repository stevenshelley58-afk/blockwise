import { FbAdCard } from "../fb-ad-card";
import { SuburbReportLocationForm } from "../suburb-report-location-form";

/**
 * Dormant suburb-report acquisition hero.
 *
 * Preserved with the suburb-report feature so the active homepage does not
 * import unavailable product marketing. This is not part of src/app/page.tsx.
 */
export function SuburbReportHero() {
  return (
    <div className="hw-hero">
      <img
        className="hw-hero-bg"
        src="/home/home-dusk.webp"
        alt=""
        aria-hidden
        fetchPriority="high"
      />
      <div className="hw-hero-scrim" aria-hidden />
      <div className="hw-wide hw-hero-grid">
        <div className="hw-hero-copy">
          <p className="hw-eyebrow">Meta ads for real estate agents</p>
          <h1 className="hw-h1">Your competitors are advertising. Are&nbsp;you?</h1>
          <p className="hw-lede">
            Ads built from what&rsquo;s actually working in your area. Start getting leads today.
          </p>
          <div className="hw-hero-form">
            <SuburbReportLocationForm analyticsLocation="hero" />
          </div>
        </div>
        <div className="hw-hero-review">
          <p className="hw-status">
            <span className="hw-status-dot" aria-hidden />
            Ready to review
          </p>
          <FbAdCard
            copy="Thinking of selling? Find out what your home could be worth with a free property appraisal."
            photoSrc="/home/interior-styled.webp"
            domain="YOURAGENCY.COM.AU"
            footHeading="Find out what your home could be worth"
            footSub="Book a free property appraisal"
          />
          <p className="hw-note">Nothing spends until you approve.</p>
        </div>
      </div>
      <p className="hw-plate">Mt Lawley, WA · Seller-lead ad · Example</p>
    </div>
  );
}
