"use client";

import { useState } from "react";

import { FAQ_DATA } from "./data";

type FaqAccordionProps = {
  /** Unique id prefix — the FAQ renders once per breakpoint tree. */
  idPrefix: string;
  /** Extra class for the question label (mobile uses a smaller size). */
  labelClassName?: string;
  /** Stagger the items' scroll reveal (desktop tree only). */
  withReveal?: boolean;
};

/**
 * Single-open FAQ accordion from the handoff: first item open initially,
 * clicking the open item closes it. The body expands via the
 * `grid-template-rows: 0fr -> 1fr` trick with a 60ms-delayed opacity fade,
 * and the plus icon rotates 45deg when open (all in homepage.css).
 */
export function FaqAccordion({ idPrefix, labelClassName, withReveal = false }: FaqAccordionProps) {
  const [open, setOpen] = useState(0);

  return (
    <div className="hw-faq-list">
      {FAQ_DATA.map((faq, i) => {
        const isOpen = open === i;
        const panelId = `${idPrefix}-faq-panel-${i}`;
        const buttonId = `${idPrefix}-faq-button-${i}`;
        return (
          <div
            key={faq.q}
            className="hw-faq-item"
            data-open={isOpen ? "true" : "false"}
            {...(withReveal ? { "data-reveal": "up", "data-rd": String(Math.min(i, 5)) } : {})}
          >
            <button
              type="button"
              id={buttonId}
              className="hw-faq-q"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpen((current) => (current === i ? -1 : i))}
            >
              <span className={["hw-faq-q-label", labelClassName].filter(Boolean).join(" ")}>
                {faq.q}
              </span>
              <span className="hw-faq-icon" aria-hidden>
                +
              </span>
            </button>
            <div id={panelId} className="hw-faq-body" role="region" aria-labelledby={buttonId}>
              <div className="hw-faq-body-clip">
                <div className="hw-faq-content">
                  <p className="hw-faq-a">{faq.a}</p>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
