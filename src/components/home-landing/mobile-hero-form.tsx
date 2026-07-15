"use client";

import { useRef } from "react";

import { trackCtaClick } from "@/lib/analytics/pixel";

/**
 * Mobile hero mini-form: a suburb input plus the "Free suburb audit" CTA.
 * Submits as a plain GET to /signup (works without JS); when JS is available
 * it drops an empty suburb param and fires the CTA analytics event.
 */
export function MobileHeroForm() {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    trackCtaClick("m_hero_suburb_audit", { href: "/signup" });
    const suburb = inputRef.current?.value.trim() ?? "";
    if (!suburb) {
      event.preventDefault();
      window.location.assign("/signup");
    }
  }

  return (
    <form className="hwm-hero-form" action="/signup" method="get" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        className="hwm-hero-input"
        type="text"
        name="suburb"
        placeholder="Start with Perth, WA or your suburb"
        aria-label="Suburb you want to advertise in"
        maxLength={120}
      />
      <button type="submit" className="hw-btn hw-btn--dark hwm-hero-cta">
        Free suburb audit <span className="hw-arr">→</span>
      </button>
    </form>
  );
}
