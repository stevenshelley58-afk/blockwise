"use client";

import { ArrowUp, Building2, MapPin, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import {
  PROPERTY_CHECK_CLIENT_SITUATION_LABELS,
  type PropertyCheckClientSituation,
  type PropertyCheckRecord,
} from "@/lib/property-check/types";

const SAMPLE_ADDRESS = "14 Montague Lane, Southern River WA 6110";

const SITUATION_CHIPS: Array<{ value: PropertyCheckClientSituation; label: string }> = [
  { value: "seller_appraisal", label: "Seller appraisal" },
  { value: "buyer_question", label: "Buyer question" },
  { value: "investor_subdivision", label: "Subdivision potential" },
];

type ApiResponse = {
  check?: PropertyCheckRecord;
  error?: string;
};

export function PropertyCheckSearch({ initialChecks }: { initialChecks: PropertyCheckRecord[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [address, setAddress] = useState("");
  const [situation, setSituation] = useState<PropertyCheckClientSituation>("general");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = address.trim().length >= 3 && !submitting;

  function fillSample() {
    setAddress(SAMPLE_ADDRESS);
    inputRef.current?.focus();
  }

  function toggleSituation(value: PropertyCheckClientSituation) {
    setSituation((current) => (current === value ? "general" : value));
    inputRef.current?.focus();
  }

  async function submitCheck(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/property-checks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: address.trim(), clientSituation: situation }),
    }).catch(() => null);
    const payload = ((await response?.json().catch(() => ({}))) ?? {}) as ApiResponse;

    if (!response?.ok || !payload.check) {
      setSubmitting(false);
      setError(payload.error ?? "Property Check could not be run right now.");
      return;
    }

    router.push(`/property-check/${payload.check.id}`);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitCheck();
    }
  }

  return (
    <div className="pc-home" aria-label="Property Check">
      <section className="pc-hero">
        <h1>Know the block before the call.</h1>

        <form className="pc-searchbox" onSubmit={(event) => void submitCheck(event)}>
          <textarea
            ref={inputRef}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Type a street address to run a property check"
            aria-label="Street address"
            maxLength={500}
            rows={2}
            disabled={submitting}
          />
          <button className="pc-go" type="submit" disabled={!canSubmit} aria-label="Run property check">
            <ArrowUp aria-hidden size={22} />
          </button>
        </form>

        {error ? (
          <p className="form-error pc-error" role="alert">
            {error}
          </p>
        ) : null}
        {submitting ? (
          <p className="pc-running" role="status">
            Running the check — gathering source-cited planning signals…
          </p>
        ) : null}

        <div className="pc-chips">
          <button type="button" className="pc-chip" onClick={fillSample} disabled={submitting}>
            <MapPin aria-hidden size={15} />
            Try an address
          </button>
          {SITUATION_CHIPS.map((chip) => (
            <button
              type="button"
              className={situation === chip.value ? "pc-chip active" : "pc-chip"}
              onClick={() => toggleSituation(chip.value)}
              aria-pressed={situation === chip.value}
              disabled={submitting}
              key={chip.value}
            >
              <MessageCircle aria-hidden size={15} />
              {chip.label}
            </button>
          ))}
        </div>
      </section>

      {initialChecks.length > 0 ? (
        <section className="pc-recent" aria-label="Recent property checks">
          <p className="pc-recent-label">Recent</p>
          <div className="pc-recent-grid">
            {initialChecks.map((check) => (
              <Link className="pc-recent-card" href={`/property-check/${check.id}`} key={check.id}>
                <span className="pc-recent-icon">
                  <Building2 aria-hidden size={18} />
                </span>
                <span className="pc-recent-body">
                  <b>{check.address}</b>
                  <small>
                    {formatDate(check.createdAt)}
                    {check.clientSituation !== "general"
                      ? ` · ${PROPERTY_CHECK_CLIENT_SITUATION_LABELS[check.clientSituation]}`
                      : ""}
                  </small>
                </span>
                <span className={check.status === "success" ? "pc-recent-badge ok" : "pc-recent-badge"}>
                  {check.status === "success" ? "Ready" : "No result"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
