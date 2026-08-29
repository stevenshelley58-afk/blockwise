"use client";

import { useState } from "react";

import { trackLead } from "@/lib/analytics/pixel";
import { gtagConversionDemoForm } from "@/lib/analytics/gtag";

const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;

type Status = "idle" | "submitting" | "success" | "error";

type ManagedSetupFormProps = {
  /** Unique id prefix — the form renders once per breakpoint tree. */
  idPrefix: string;
  variant: "desktop" | "mobile";
};

type FieldProps = {
  id: string;
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  maxLength?: number;
  mobile: boolean;
};

function Field({ id, label, name, type = "text", autoComplete, required, maxLength, mobile }: FieldProps) {
  return (
    <label className={mobile ? "hwm-ms-field" : "hw-ms-field"} htmlFor={id}>
      <span className={mobile ? "hwm-ms-label" : "hw-ms-label"}>{label}</span>
      <input
        id={id}
        className={mobile ? "hwm-ms-input" : "hw-ms-input"}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        maxLength={maxLength}
      />
    </label>
  );
}

/**
 * Managed-setup lead form, wired to the existing `/api/demo-request`
 * endpoint. Field set follows the handoff layout; the handoff's visible
 * "Company website" slot is rendered as "Agency (optional)" because
 * `company_website` is the API's spam honeypot (kept here as a genuinely
 * hidden input — any value in it fails validation by design).
 */
export function ManagedSetupForm({ idPrefix, variant }: ManagedSetupFormProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const mobile = variant === "mobile";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      suburb: String(data.get("suburb") ?? ""),
      phone: String(data.get("phone") ?? ""),
      agency: String(data.get("agency") ?? ""),
      company_website: String(data.get("company_website") ?? ""), // honeypot
    };

    setStatus("submitting");
    setError(null);

    try {
      const res = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Something went wrong. Please try again.");
      }

      // Fire conversion events only on a confirmed save.
      trackLead({ content_name: "managed_setup_request", suburb: payload.suburb || undefined });
      if (GOOGLE_ADS_ID) gtagConversionDemoForm(GOOGLE_ADS_ID);
      form.reset();
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div
        className={mobile ? "hwm-ms-success" : "hw-ms-success"}
        role="status"
        aria-live="polite"
        data-reveal={mobile ? undefined : "up"}
        data-in="1"
      >
        <div className="hw-ms-success-h">Thanks, we&rsquo;ve got it.</div>
        <p className="hw-ms-success-b">
          We&rsquo;ll be in touch within one business day to book your 15-minute walkthrough.
        </p>
      </div>
    );
  }

  const errorId = `${idPrefix}-error`;
  const fields = {
    name: (
      <Field
        id={`${idPrefix}-name`}
        label="Your name"
        name="name"
        autoComplete="name"
        required
        maxLength={120}
        mobile={mobile}
      />
    ),
    email: (
      <Field
        id={`${idPrefix}-email`}
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={200}
        mobile={mobile}
      />
    ),
    suburb: (
      <Field
        id={`${idPrefix}-suburb`}
        label="Suburb you want to advertise in"
        name="suburb"
        maxLength={120}
        mobile={mobile}
      />
    ),
    phone: (
      <Field
        id={`${idPrefix}-phone`}
        label="Phone (optional)"
        name="phone"
        type="tel"
        autoComplete="tel"
        maxLength={40}
        mobile={mobile}
      />
    ),
    agency: (
      <Field
        id={`${idPrefix}-agency`}
        label="Agency (optional)"
        name="agency"
        autoComplete="organization"
        maxLength={160}
        mobile={mobile}
      />
    ),
  };

  const honeypot = (
    <div className="hw-ms-hp" aria-hidden>
      <label htmlFor={`${idPrefix}-company-website`}>Company website</label>
      <input
        id={`${idPrefix}-company-website`}
        name="company_website"
        type="text"
        tabIndex={-1}
        autoComplete="off"
      />
    </div>
  );

  if (mobile) {
    return (
      <form
        className="hwm-ms-form"
        onSubmit={handleSubmit}
        noValidate={false}
        aria-describedby={error ? errorId : undefined}
      >
        {fields.name}
        {fields.email}
        {fields.suburb}
        {fields.phone}
        {fields.agency}
        {honeypot}
        {error ? (
          <p id={errorId} className="hwm-ms-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="hw-btn hw-btn--dark hwm-ms-submit" disabled={status === "submitting"}>
          {status === "submitting" ? "Sending…" : "Book a 15-minute walkthrough"}{" "}
          <span className="hw-arr">→</span>
        </button>
        <div className="hwm-ms-fineprint">No obligation. We&rsquo;ll never share your details.</div>
      </form>
    );
  }

  return (
    <form
      className="hw-ms-form"
      onSubmit={handleSubmit}
      data-reveal="up"
      data-rd="1"
      aria-describedby={error ? errorId : undefined}
    >
      <div className="hw-ms-row">
        {fields.name}
        {fields.email}
      </div>
      {fields.suburb}
      <div className="hw-ms-row">
        {fields.phone}
        {fields.agency}
      </div>
      {honeypot}
      {error ? (
        <p id={errorId} className="hw-ms-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="hw-ms-actions">
        <button type="submit" className="hw-btn hw-btn--dark hw-ms-submit" disabled={status === "submitting"}>
          {status === "submitting" ? "Sending…" : "Book a 15-minute walkthrough"}{" "}
          <span className="hw-arr">→</span>
        </button>
        <span className="hw-ms-fineprint">No obligation. We&rsquo;ll never share your details.</span>
      </div>
    </form>
  );
}
