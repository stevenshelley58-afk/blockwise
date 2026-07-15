"use client";

import { useState } from "react";

import { trackLead } from "@/lib/analytics/pixel";
import { gtagConversionDemoForm } from "@/lib/analytics/gtag";

const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;

type Status = "idle" | "submitting" | "success" | "error";

type FieldProps = {
  id: string;
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  maxLength?: number;
};

function Field({ id, label, name, type = "text", autoComplete, required, maxLength }: FieldProps) {
  return (
    <label className="home-form-field" htmlFor={id}>
      <span className="home-form-label">{label}</span>
      <input
        id={id}
        className="home-form-input"
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        maxLength={maxLength}
      />
    </label>
  );
}

export function ManagedSetupForm({ idPrefix }: { idPrefix: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

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
      company_website: String(data.get("company_website") ?? ""),
    };

    setStatus("submitting");
    setError(null);

    try {
      const response = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "We could not send your request. Check your connection and try again.");
      }

      trackLead({ content_name: "managed_setup_request", suburb: payload.suburb || undefined });
      if (GOOGLE_ADS_ID) gtagConversionDemoForm(GOOGLE_ADS_ID);
      form.reset();
      setStatus("success");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "We could not send your request. Check your connection and try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="home-form-success" role="status" aria-live="polite">
        <strong>Thanks. We have your request.</strong>
        <p>We will be in touch within one business day to book your 15-minute walkthrough.</p>
      </div>
    );
  }

  const errorId = `${idPrefix}-error`;

  return (
    <form className="home-form" onSubmit={handleSubmit} aria-describedby={error ? errorId : undefined}>
      <div className="home-form-row">
        <Field id={`${idPrefix}-name`} label="Your name" name="name" autoComplete="name" required maxLength={120} />
        <Field id={`${idPrefix}-email`} label="Email" name="email" type="email" autoComplete="email" required maxLength={200} />
      </div>
      <Field id={`${idPrefix}-suburb`} label="Suburb you want to advertise in" name="suburb" maxLength={120} />
      <div className="home-form-row">
        <Field id={`${idPrefix}-phone`} label="Phone (optional)" name="phone" type="tel" autoComplete="tel" maxLength={40} />
        <Field id={`${idPrefix}-agency`} label="Agency (optional)" name="agency" autoComplete="organization" maxLength={160} />
      </div>
      <div className="home-form-honeypot" aria-hidden>
        <label htmlFor={`${idPrefix}-company-website`}>Company website</label>
        <input id={`${idPrefix}-company-website`} name="company_website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      {error ? <p id={errorId} className="home-form-error" role="alert">{error}</p> : null}
      <div className="home-form-actions">
        <button type="submit" className="home-button home-button-primary" disabled={status === "submitting"}>
          {status === "submitting" ? "Sending..." : "Request setup help"}
        </button>
        <span>No obligation. We never share your details.</span>
      </div>
    </form>
  );
}
