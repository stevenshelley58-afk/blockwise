import { ArrowRight, CalendarClock, Mail } from "lucide-react";

import {
  BOOKING_CALL,
  BOOKING_MODE,
  BOOKING_POINTS,
  CONTACT_EMAIL,
  CONTACT_HREF,
} from "@/lib/homepage-concept/content";

import "./homepage-booking.css";

/**
 * Closing section: the path for a visitor who has read the page and wants a
 * person rather than a signup form. It states the length and the cost. The
 * action follows BOOKING_MODE, so it either asks for times by email or hands
 * over to SnagTime for a real slot, and never promises a picker that is not
 * there.
 */
export function HomepageBooking() {
  const call = BOOKING_CALL[BOOKING_MODE];

  return (
    <section className="hb-booking" id="book-a-call" aria-labelledby="hb-booking-title">
      <div className="hc-shell hb-booking-grid">
        <div className="hb-booking-copy">
          <h2 id="hb-booking-title">Book a call first</h2>
          <p>
            Talk through the ads you want to run and what getting started involves.
          </p>
          <ul className="hb-booking-points">
            {BOOKING_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
        <div className="hb-booking-card">
          <CalendarClock aria-hidden="true" size={26} />
          <h3>Find a time that works</h3>
          <p>{call.detail}</p>
          <a className="hb-booking-cta" href={call.href}>
            {call.action}
            <ArrowRight aria-hidden="true" size={16} />
          </a>
          {BOOKING_MODE === "live" ? (
            <p className="hb-booking-alt">
              <Mail aria-hidden="true" size={14} />
              <span>
                Prefer email? <a href={CONTACT_HREF}>{CONTACT_EMAIL}</a>
              </span>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
