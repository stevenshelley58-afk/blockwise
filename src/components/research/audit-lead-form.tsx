"use client";

import { track } from "@vercel/analytics";
import { useState, type FormEvent } from "react";

type AuditLeadFormProps = {
  location: string;
  signupHref: string;
};

export function AuditLeadForm({ location, signupHref }: AuditLeadFormProps) {
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      email: String(form.get("email") ?? "").trim(),
      agency: String(form.get("agency") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim(),
      goal: String(form.get("goal") ?? "").trim(),
      notes: String(form.get("notes") ?? "").trim(),
      location,
      source: "audit-plan",
      company_website: String(form.get("company_website") ?? ""),
    };

    try {
      const response = await fetch("/api/research/audit/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error ?? "Could not send your plan.");
      try {
        track("audit_lead_submit", { market: location });
      } catch {
        // analytics best-effort
      }
      setDone(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="audit-lead-done">
        <h3>Your {location} campaign plan is on the way.</h3>
        <p>Check your inbox shortly. Want to start building it now?</p>
        <a className="lp-btn lp-btn-primary lp-btn-big" href={signupHref}>Start your free trial</a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row">
        <label>
          Work email
          <input name="email" type="email" autoComplete="email" required placeholder="you@agency.com.au" />
        </label>
        <label>
          Agency name
          <input name="agency" type="text" autoComplete="organization" required placeholder="Agency name" />
        </label>
      </div>
      <div className="form-row">
        <label>
          Phone (optional)
          <input name="phone" type="tel" autoComplete="tel" placeholder="0400 000 000" />
        </label>
        <label>
          Main goal
          <select name="goal" required defaultValue="">
            <option value="" disabled>Choose one</option>
            <option value="vendor_leads">Vendor leads</option>
            <option value="buyer_leads">Buyer leads</option>
            <option value="listing_promotion">Promote a listing</option>
            <option value="market_update">Market update</option>
          </select>
        </label>
      </div>
      <label>
        Notes (optional)
        <textarea name="notes" placeholder="Example: I want more appraisal leads in the surrounding suburbs." />
      </label>
      <input
        type="text"
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
      />
      {error ? <p className="audit-lead-error">{error}</p> : null}
      <button className="lp-btn lp-btn-primary lp-btn-big lp-btn-wide" type="submit" disabled={submitting}>
        {submitting ? "Sending..." : `Send my ${location} campaign plan`}
      </button>
      <p className="fine-print">No spam. We email the plan and follow up about a trial or a 15-minute setup call.</p>
    </form>
  );
}
