"use client";

import { useState } from "react";

type State = "idle" | "submitting" | "done" | "error";

export function AuditSnapshotSignup({ location }: { location: string }) {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "submitting") return;
    setState("submitting");
    setMessage("");
    try {
      const response = await fetch("/api/research/audit/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, location, company_website: website }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setState("error");
        setMessage(typeof payload?.error === "string" ? payload.error : "Something went wrong. Please try again.");
        return;
      }
      setState("done");
    } catch {
      setState("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  if (state === "done") {
    return (
      <div className="audit-signup audit-signup-done" role="status">
        <strong>Thanks &mdash; you&rsquo;re on the list.</strong>
        <span>We&rsquo;ll send future snapshots of {location} as the public data changes.</span>
      </div>
    );
  }

  return (
    <form className="audit-signup" onSubmit={handleSubmit} noValidate>
      <label className="audit-signup-field">
        <span className="audit-signup-hint">Email me future snapshots</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@agency.com.au"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <input
        type="text"
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="audit-signup-trap"
        value={website}
        onChange={(event) => setWebsite(event.target.value)}
      />
      <button type="submit" className="lp-btn lp-btn-primary" disabled={state === "submitting"}>
        {state === "submitting" ? "Saving..." : "Email me future snapshots"}
      </button>
      {state === "error" && <p className="audit-signup-error">{message}</p>}
      <p className="audit-signup-fine">No account, no card. One email per new snapshot, unsubscribe anytime.</p>
    </form>
  );
}
