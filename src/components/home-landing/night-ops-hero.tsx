import { CountUp } from "@/components/motion";

import { SuburbReportLocationForm } from "./suburb-report-location-form";

import "./night-ops-hero.css";

/* ---------- #top — Night Ops hero (dark map fold) ----------
   The suburb boundary is baked into the map asset so it follows the real
   street grid (reads as an actual selected suburb). Copy + working suburb
   search sit left; illustrative metric cards float right. */
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

      <div className="hw-no-content">
        <h1 className="hw-no-h1">
          Your competitors are
          <br />
          advertising.
          <br />
          <span className="hw-no-accent">Are you?</span>
        </h1>
        <div className="hw-no-form">
          <SuburbReportLocationForm analyticsLocation="hero" />
        </div>
      </div>

      <div className="hw-no-cards" aria-hidden>
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

      <p className="hw-no-plate">Illustrative data · Perth metro</p>
    </div>
  );
}
