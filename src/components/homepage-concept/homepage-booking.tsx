import { ArrowRight, CalendarClock, Mail } from "lucide-react";

import {
  BOOKING_HREF,
  BOOKING_POINTS,
  CONTACT_EMAIL,
  CONTACT_HREF,
} from "@/lib/homepage-concept/content";

import "./homepage-booking.css";

/**
 * Closing section: the path for a visitor who has read the page and wants a
 * person rather than a signup form. It states the length and the cost, then
 * hands over to SnagTime for live availability, so nothing here promises a
 * time slot the scheduler has not actually offered.
 */
export function HomepageBooking() {
  return (
    <section className="hb-booking" id="book-a-call" aria-labelledby="hb-booking-title">
      <div className="hc-shell hb-booking-grid">
        <div className="hb-booking-copy">
          <h2 id="hb-booking-title">Book a call first</h2>
          <p>
            Pick a time that suits you. We will look at your area, the properties you want to
            advertise, and what your first month would involve.
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
          <p>
            You will see live availability and get a confirmation straight away, plus a calendar
            invite.
          </p>
          <a className="hb-booking-cta" href={BOOKING_HREF}>
            See available times
            <ArrowRight aria-hidden="true" size={16} />
          </a>
          <p className="hb-booking-alt">
            <Mail aria-hidden="true" size={14} />
            <span>
              Prefer email? <a href={CONTACT_HREF}>{CONTACT_EMAIL}</a>
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
