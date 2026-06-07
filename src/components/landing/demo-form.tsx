"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { trackLead } from "@/lib/analytics/pixel";

type Status = "idle" | "submitting" | "success" | "error";

export function DemoForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") ?? ""),
      agency: String(data.get("agency") ?? ""),
      email: String(data.get("email") ?? ""),
      phone: String(data.get("phone") ?? ""),
      suburb: String(data.get("suburb") ?? ""),
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

      // Fire the Meta Pixel conversion only on a confirmed save.
      trackLead({ content_name: "demo_request", suburb: payload.suburb || undefined });
      form.reset();
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="demo-form-success" role="status" aria-live="polite">
        <strong>Thanks - we&apos;ve got it.</strong>
        <p>We&apos;ll be in touch within one business day to book your 15-minute walkthrough.</p>
      </div>
    );
  }

  return (
    <form className="demo-form" onSubmit={handleSubmit} noValidate aria-describedby={error ? "demo-form-error" : undefined}>
      <div className="demo-form-grid">
        <div className="demo-field">
          <label htmlFor="demo-name">Your name</label>
          <input id="demo-name" name="name" type="text" autoComplete="name" required maxLength={120} />
        </div>
        <div className="demo-field">
          <label htmlFor="demo-agency">Agency</label>
          <input id="demo-agency" name="agency" type="text" autoComplete="organization" maxLength={160} />
        </div>
        <div className="demo-field">
          <label htmlFor="demo-email">Email</label>
          <input id="demo-email" name="email" type="email" autoComplete="email" required maxLength={200} />
        </div>
        <div className="demo-field">
          <label htmlFor="demo-phone">Phone</label>
          <input id="demo-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} />
        </div>
        <div className="demo-field demo-field-wide">
          <label htmlFor="demo-suburb">Suburb you want to advertise in</label>
          <input id="demo-suburb" name="suburb" type="text" placeholder="e.g. Mount Lawley" maxLength={120} />
        </div>
      </div>

      {/* Honeypot - visually hidden, ignored by humans, catches bots. */}
      <div aria-hidden className="demo-honeypot">
        <label htmlFor="demo-company-website">Company website</label>
        <input id="demo-company-website" name="company_website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {error ? (
        <p className="demo-form-error" id="demo-form-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className="button primary big" disabled={status === "submitting"}>
        {status === "submitting" ? "Sending..." : "Request managed setup"}
        <ArrowRight aria-hidden size={18} />
      </button>
      <p className="demo-form-fine">No obligation. We&apos;ll never share your details.</p>
    </form>
  );
}
