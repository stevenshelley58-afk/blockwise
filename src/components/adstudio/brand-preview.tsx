"use client";

/* ------------------------------------------------------------------ */
/* logo proof strip + live preview rail                                */
/* ------------------------------------------------------------------ */

export function LogoProofStrip({
  logoPreviewUrl,
  initial,
  brandName,
  primaryColour,
}: {
  logoPreviewUrl: string;
  initial: string;
  brandName: string;
  primaryColour: string;
}) {
  return (
    <div className="bs-logo-proof">
      <div className="lp">
        <div className="face" style={{ background: "#fff", color: primaryColour }}>
          {logoPreviewUrl ? <img src={logoPreviewUrl} alt="" /> : `${initial}★ ${brandName.split(" ")[0]?.toLowerCase()}`}
        </div>
        <small>
          <b>Primary</b>
          <em>on light</em>
        </small>
      </div>
      <div className="lp">
        <div className="face" style={{ background: "#001b3d", color: "#fff" }}>
          {initial}★ {brandName.split(" ")[0]?.toLowerCase()}
        </div>
        <small>
          <b>Dark</b>
          <em>on dark</em>
        </small>
      </div>
      <div className="lp">
        <div className="face photo">{initial}★</div>
        <small>
          <b>Mark</b>
          <em>on photo</em>
        </small>
      </div>
    </div>
  );
}

export function PreviewRail({
  brandName,
  initial,
  headline,
  voiceLine,
  primaryColour,
  secondaryColour,
}: {
  brandName: string;
  initial: string;
  headline: string;
  voiceLine: string;
  primaryColour: string;
  secondaryColour: string;
}) {
  return (
    <aside className="bs-rail">
      <div className="rail-stage">
        <span className="lbl">Live preview</span>
        <div className="minis">
          <div className="mini-story">
            <span className="bc" style={{ color: primaryColour }}>
              {initial}★ {brandName.split(" ")[0]}
            </span>
            <h5>{headline}</h5>
            <span className="cta" style={{ color: primaryColour }}>
              Book free appraisal
            </span>
          </div>
          <div className="mini-feed">
            <div className="fh">
              <i style={{ background: primaryColour }}>{initial}</i>
              <b>{brandName}</b>
            </div>
            <div className="img" />
            <div className="ft">
              <b>Free appraisal</b>
              <span style={{ background: secondaryColour }}>Book</span>
            </div>
          </div>
        </div>
        <small>
          Re-renders as you edit — voice line:
          <br />
          <b>{voiceLine || "describe your voice above"}</b>
        </small>
      </div>
    </aside>
  );
}
