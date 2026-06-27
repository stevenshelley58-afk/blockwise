"use client";

import { Download, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

const READY_EVENT = "blockwise:audit-suggestions-ready";

type AuditPdfButtonProps = {
  location: string;
  className?: string;
  label?: string;
};

export function AuditPdfButton({ location, className, label = "Download PDF report" }: AuditPdfButtonProps) {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onReady() {
      setReady(true);
    }
    window.addEventListener(READY_EVENT, onReady);
    const timer = window.setTimeout(() => setReady(true), 9000);
    return () => {
      window.removeEventListener(READY_EVENT, onReady);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => emailRef.current?.focus(), 0);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      agency: String(form.get("agency") ?? "").trim(),
      location,
      company_website: String(form.get("company_website") ?? ""),
    };

    try {
      const response = await fetch("/api/research/audit/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error ?? "Could not save your details.");
      setOpen(false);
      window.setTimeout(() => window.print(), 350);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button type="button" className={className ?? "lp-btn lp-btn-primary"} onClick={() => setOpen(true)} disabled={!ready} data-audit-pdf>
        {ready ? <Download size={16} aria-hidden /> : <Loader2 size={16} aria-hidden className="audit-spin" />}
        {ready ? label : "Preparing report…"}
      </button>

      {open ? (
        <div className="audit-modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <div className="audit-modal" role="dialog" aria-modal="true" aria-labelledby="audit-modal-title">
            <button type="button" className="audit-modal-close" onClick={() => setOpen(false)} aria-label="Close">
              <X size={18} aria-hidden />
            </button>
            <p className="audit-modal-kicker">Free PDF report</p>
            <h3 id="audit-modal-title">Where should we send your audit?</h3>
            <p className="audit-modal-sub">
              Enter your details to download the full {location} ad audit as a branded PDF. No spam — just the report.
            </p>
            <form onSubmit={onSubmit} className="audit-modal-form">
              <label>
                <span>Your name</span>
                <input name="name" type="text" required maxLength={120} autoComplete="name" placeholder="Jordan Smith" />
              </label>
              <label>
                <span>Work email</span>
                <input ref={emailRef} name="email" type="email" required maxLength={200} autoComplete="email" placeholder="jordan@agency.com.au" />
              </label>
              <label>
                <span>Agency <em>(optional)</em></span>
                <input name="agency" type="text" maxLength={160} autoComplete="organization" placeholder="Acton Belle Property" />
              </label>
              <input type="text" name="company_website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />
              {error ? <p className="audit-modal-error">{error}</p> : null}
              <button type="submit" className="lp-btn lp-btn-primary lp-btn-wide" disabled={submitting}>
                {submitting ? <Loader2 size={16} aria-hidden className="audit-spin" /> : <Download size={16} aria-hidden />}
                {submitting ? "Preparing…" : "Get the PDF"}
              </button>
              <p className="audit-modal-fineprint">
                We&rsquo;ll open your browser&rsquo;s print dialog — choose &ldquo;Save as PDF&rdquo;. By continuing you agree to be contacted about Blockwise.
              </p>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
