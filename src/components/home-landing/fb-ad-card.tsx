type FbAdCardProps = {
  copy: string;
  photoSrc: string;
  photoAlt?: string;
  domain: string;
  footHeading: string;
  footSub?: string;
};

/**
 * Quiet, realistic render of a finished Meta feed ad. This is a product
 * render — not a clickable element — used to show the deliverable itself.
 */
export function FbAdCard({ copy, photoSrc, photoAlt, domain, footHeading, footSub }: FbAdCardProps) {
  return (
    <figure className="hw-fbad">
      <div className="hw-fbad-head">
        <span className="hw-fbad-avatar" aria-hidden>YA</span>
        <span className="hw-fbad-id">
          <span className="hw-fbad-agency">Your Agency</span>
          <span className="hw-fbad-sponsored">Sponsored</span>
        </span>
      </div>
      <p className="hw-fbad-copy">{copy}</p>
      <div className="hw-fbad-photo"><img src={photoSrc} alt={photoAlt ?? ""} /></div>
      <div className="hw-fbad-foot">
        <span className="hw-fbad-foot-l">
          <span className="hw-fbad-domain">{domain}</span>
          <span className="hw-fbad-foot-h">{footHeading}</span>
          {footSub ? <span className="hw-fbad-foot-sub">{footSub}</span> : null}
        </span>
        <span className="hw-fbad-btn">Learn more</span>
      </div>
    </figure>
  );
}
