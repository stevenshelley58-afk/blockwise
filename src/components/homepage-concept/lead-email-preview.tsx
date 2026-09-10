"use client";

import { withBasePath } from "@/lib/homepage-concept/content";
import { LEAD_EMAIL_TEMPLATE } from "@/lib/homepage-concept/lead-email";

/** Renders the designed new lead email. Static preview — nothing is sent. */
export function LeadEmailPreview() {
  const email = LEAD_EMAIL_TEMPLATE;
  const links = [...email.preferenceLinks, email.supportLink];

  return (
    <div className="rr-lead-email" aria-label="New lead email preview">
      <div className="rr-lead-email-grid">
        <figure className="rr-lead-email-creative">
          <figcaption>Related creative</figcaption>
          <img
            className="rr-lead-email-creative-img"
            src={withBasePath(email.creative.src)}
            alt={email.creative.alt}
            width={190}
            height={285}
          />
          <strong>{email.creative.label}</strong>
        </figure>

        <article className="rr-lead-email-card">
          <img
            className="rr-lead-email-brand"
            src={withBasePath("/brand/blockwise-logo.svg")}
            alt="Blockwise"
            width={108}
            height={26}
          />
          <p className="rr-lead-email-eyebrow">{email.previewLabel}</p>
          <p className="rr-lead-email-intro">{email.intro}</p>
          <p className="rr-lead-email-action">{email.action}</p>

          <dl className="rr-lead-email-details">
            {email.details.map((detail) => (
              <div key={detail.label}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>

          <p className="rr-lead-email-privacy">{email.privacy}</p>
          <p className="rr-lead-email-signoff">{email.signOff}</p>
        </article>
      </div>

      <div className="rr-lead-email-footer">
        <p>{email.preferenceNote}</p>
        <ul>
          {links.map((label) => (
            <li key={label}><a href="#">{label}</a></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
