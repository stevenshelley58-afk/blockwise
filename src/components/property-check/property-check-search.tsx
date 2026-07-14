"use client";

import { ArrowUp, Building2, MapPin, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import type { PropertyAddressPrediction } from "@/lib/property-check/address-autocomplete";
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

type AutocompleteResponse = {
  predictions?: PropertyAddressPrediction[];
  source?: "google" | "none";
};

export function PropertyCheckSearch({ initialChecks }: { initialChecks: PropertyCheckRecord[] }) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const suppressedAddressRef = useRef<string | null>(null);
  const [address, setAddress] = useState("");
  const [situation, setSituation] = useState<PropertyCheckClientSituation>("general");
  const [suggestions, setSuggestions] = useState<PropertyAddressPrediction[]>([]);
  const [suggestionSource, setSuggestionSource] = useState<AutocompleteResponse["source"]>("none");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [sessionToken] = useState(createSessionToken);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = address.trim().length >= 3 && !submitting;
  const showSuggestions = isFocused && suggestions.length > 0 && !submitting;

  useEffect(() => {
    const query = address.trim();
    setActiveIndex(-1);

    if (!isFocused || submitting || query.length < 3 || query === suppressedAddressRef.current) {
      setSuggestions([]);
      setSuggestionSource("none");
      setSuggestionsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSuggestionsLoading(true);
      const params = new URLSearchParams({ q: query, session: sessionToken });
      void fetch(`/api/property-checks/addresses/autocomplete?${params.toString()}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: AutocompleteResponse | null) => {
          if (controller.signal.aborted || query === suppressedAddressRef.current) return;
          setSuggestions(payload?.predictions ?? []);
          setSuggestionSource(payload?.source ?? "none");
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSuggestions([]);
            setSuggestionSource("none");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSuggestionsLoading(false);
        });
    }, 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [address, isFocused, sessionToken, submitting]);

  function fillSample() {
    suppressedAddressRef.current = SAMPLE_ADDRESS;
    setAddress(SAMPLE_ADDRESS);
    setSuggestions([]);
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

  function chooseSuggestion(suggestion: PropertyAddressPrediction) {
    suppressedAddressRef.current = suggestion.label;
    setAddress(suggestion.label);
    setSuggestions([]);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (showSuggestions && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (showSuggestions && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (showSuggestions && event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      chooseSuggestion(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      suppressedAddressRef.current = address.trim();
      setSuggestions([]);
      setActiveIndex(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void submitCheck();
    }
  }

  return (
    <div className="pc-home" aria-label="Property Check">
      <section className="pc-hero">
        <h1>Know the block before the call.</h1>

        <form className="pc-searchbox" onSubmit={(event) => void submitCheck(event)}>
          <input
            id={`${listId}-input`}
            ref={inputRef}
            value={address}
            onBlur={() => window.setTimeout(() => setIsFocused(false), 120)}
            onChange={(event) => {
              suppressedAddressRef.current = null;
              setAddress(event.target.value);
              setError(null);
            }}
            onFocus={() => setIsFocused(true)}
            onKeyDown={onInputKeyDown}
            placeholder="Type a street address to run a property check"
            aria-label="Street address"
            aria-autocomplete="list"
            aria-controls={`${listId}-list`}
            aria-expanded={showSuggestions}
            aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
            autoComplete="off"
            role="combobox"
            maxLength={500}
            disabled={submitting}
          />
          {showSuggestions ? (
            <div
              id={`${listId}-list`}
              className="pc-address-suggestions"
              role="listbox"
              onMouseDown={(event) => event.preventDefault()}
            >
              {suggestions.map((suggestion, index) => (
                <button
                  id={`${listId}-option-${index}`}
                  aria-selected={index === activeIndex}
                  className="pc-address-option"
                  key={suggestion.placeId}
                  onClick={() => chooseSuggestion(suggestion)}
                  role="option"
                  type="button"
                >
                  <MapPin aria-hidden size={17} />
                  <span>
                    <strong>{suggestion.mainText}</strong>
                    {suggestion.secondaryText ? <small>{suggestion.secondaryText}</small> : null}
                  </span>
                </button>
              ))}
              {suggestionSource === "google" ? <span className="pc-address-powered">Powered by Google</span> : null}
            </div>
          ) : null}
          <button className="pc-go" type="submit" disabled={!canSubmit} aria-label="Run property check">
            <ArrowUp aria-hidden size={22} />
          </button>
        </form>

        <span className="sr-only" aria-live="polite">
          {suggestionsLoading
            ? "Looking for matching addresses"
            : showSuggestions
              ? `${suggestions.length} address suggestions available`
              : ""}
        </span>

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

function createSessionToken(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
