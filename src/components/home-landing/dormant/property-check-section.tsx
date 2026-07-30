import { CtaLink } from "@/components/landing/cta-link";

const PROPERTY_USES = ["Seller prep", "Buyer questions", "Lead follow-up"] as const;

const PROPERTY_NOTES = [
  {
    text: "Corner lot in a dual-density area. Retain-and-build may apply.",
    source: "Local planning scheme",
  },
  {
    text: "Heritage overlay. External changes may need approval.",
    source: "Heritage list",
  },
  {
    text: "Front setback limits apply. Check before quoting works.",
    source: "R-Codes",
  },
] as const;

/**
 * Dormant Property Check marketing section.
 *
 * Kept with the feature while Property Check is unavailable. This is not part
 * of src/app/page.tsx.
 */
export function PropertyCheckSection() {
  return (
    <div className="hw-fold hw-pc">
      <div className="hw-wide hw-pc-grid">
        <div className="hw-pc-copy">
          <h2>Know the property before the call</h2>
          <p className="hw-sub">Zoning, overlays and red flags before you call.</p>
          <div className="hw-pc-chips">
            {PROPERTY_USES.map((use) => (
              <span className="hw-pc-chip" key={use}>
                {use}
              </span>
            ))}
          </div>
          <CtaLink
            location="property_check"
            href="/signup?source=property-check"
            className="hw-textlink"
          >
            Run a property check <span className="hw-arr">→</span>
          </CtaLink>
        </div>
        <div className="hw-pc-panel">
          <div className="hw-pc-panel-head">
            <span className="hw-pc-panel-addr">
              14 Sample St, Mt Lawley WA <span className="hw-tag">Example</span>
            </span>
            <span className="hw-pc-panel-status">Check complete</span>
          </div>
          <div className="hw-pc-facts">
            <span className="hw-pc-fact">
              <span className="hw-pc-fact-k">Zoning</span>
              <span className="hw-pc-fact-v">R20 / R40</span>
            </span>
            <span className="hw-pc-fact">
              <span className="hw-pc-fact-k">Overlays</span>
              <span className="hw-pc-fact-v">Heritage area</span>
            </span>
            <span className="hw-pc-fact">
              <span className="hw-pc-fact-k">Subdivision</span>
              <span className="hw-pc-fact-v hw-pc-fact-v--warning">Potential. Verify lot width.</span>
            </span>
          </div>
          <ul className="hw-pc-notes">
            {PROPERTY_NOTES.map((note) => (
              <li key={note.text}>
                <span className="hw-line-dot hw-line-dot--faint" aria-hidden />
                <span>
                  {note.text} <span className="hw-pc-note-src">{note.source}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="hw-pc-panel-foot">Always confirm with the local planning authority.</p>
        </div>
      </div>
    </div>
  );
}
