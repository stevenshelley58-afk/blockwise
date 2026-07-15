"use client";

import { useState } from "react";

import { FAQ_DATA } from "./data";

export function FaqAccordion({ idPrefix }: { idPrefix: string }) {
  const [open, setOpen] = useState(0);

  return (
    <div className="home-faq-list">
      {FAQ_DATA.map((faq, index) => {
        const isOpen = open === index;
        const panelId = `${idPrefix}-faq-panel-${index}`;
        const buttonId = `${idPrefix}-faq-button-${index}`;
        return (
          <div key={faq.q} className="home-faq-item" data-open={isOpen ? "true" : "false"}>
            <button
              type="button"
              id={buttonId}
              className="home-faq-question"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpen((current) => (current === index ? -1 : index))}
            >
              <span>{faq.q}</span>
              <span className="home-faq-icon" aria-hidden>+</span>
            </button>
            <div id={panelId} className="home-faq-answer" role="region" aria-labelledby={buttonId}>
              <div><p>{faq.a}</p></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
