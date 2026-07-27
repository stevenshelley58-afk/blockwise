"use client";

import { ArrowUp, Building2, MapPin, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { niche } from "@/config/niche";
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

  const chipClass = (active: boolean) =>
    `inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-full border px-[13px] text-xs font-bold transition-[background,color,border-color,transform] duration-150 active:scale-[0.96] disabled:cursor-default disabled:opacity-50 ${
      active
        ? "border-(--ink) bg-(--ink) text-white"
        : "border-(--line) bg-(--surface) text-foreground hover:border-(--line-heavy)"
    }`;

  return (
    <div className="grid gap-8" aria-label="Property Check">
      <section className="grid gap-4">
        <div>
          <h1 className="font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">
            {niche.copy.propertyCheck.heroTitle}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">{niche.copy.propertyCheck.heroLead}</p>
        </div>

        <form
          className="relative flex items-center gap-2 rounded-full border border-(--line) bg-(--surface) py-1.5 pr-1.5 pl-4 shadow-card transition-[border-color,box-shadow] duration-150 focus-within:border-(--ink) focus-within:shadow-float"
          onSubmit={(event) => void submitCheck(event)}
        >
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
            placeholder={niche.copy.propertyCheck.searchPlaceholder}
            aria-label="Street address"
            aria-autocomplete="list"
            aria-controls={`${listId}-list`}
            aria-expanded={showSuggestions}
            aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
            autoComplete="off"
            role="combobox"
            maxLength={500}
            disabled={submitting}
            className="h-11 min-w-0 flex-1 border-0 bg-transparent text-[14px] font-semibold outline-none placeholder:text-(--faint)"
          />
          {showSuggestions ? (
            <div
              id={`${listId}-list`}
              className="absolute top-[calc(100%+6px)] left-0 z-20 w-full overflow-hidden rounded-(--r-card) border border-(--line) bg-(--surface) shadow-float"
              role="listbox"
              onMouseDown={(event) => event.preventDefault()}
            >
              {suggestions.map((suggestion, index) => (
                <button
                  id={`${listId}-option-${index}`}
                  aria-selected={index === activeIndex}
                  className="flex w-full cursor-pointer items-center gap-2.5 border-0 bg-(--surface) px-3.5 py-2.5 text-left transition-colors duration-100 hover:bg-(--surface-subtle) aria-selected:bg-(--surface-subtle)"
                  key={suggestion.placeId}
                  onClick={() => chooseSuggestion(suggestion)}
                  role="option"
                  type="button"
                >
                  <MapPin aria-hidden size={16} className="shrink-0 text-(--faint)" />
                  <span className="grid min-w-0 gap-0.5">
                    <strong className="truncate text-[13.5px] font-bold text-foreground">{suggestion.mainText}</strong>
                    {suggestion.secondaryText ? (
                      <small className="block truncate text-xs text-muted-foreground">{suggestion.secondaryText}</small>
                    ) : null}
                  </span>
                </button>
              ))}
              {suggestionSource === "google" ? (
                <span className="block border-t border-(--line) px-3.5 py-2 text-right text-[10.5px] font-bold text-(--faint)">
                  Powered by Google
                </span>
              ) : null}
            </div>
          ) : null}
          <button
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-(--ink) text-white transition-[opacity,transform] duration-150 hover:opacity-85 active:scale-[0.95] disabled:cursor-default disabled:opacity-40"
            type="submit"
            disabled={!canSubmit}
            aria-label="Run property check"
          >
            <ArrowUp aria-hidden size={20} />
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
          <p className="text-[12.5px] font-bold text-error" role="alert">
            {error}
          </p>
        ) : null}
        {submitting ? (
          <p className="animate-pulse text-[12.5px] font-bold text-muted-foreground" role="status">
            Checking…
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button type="button" className={chipClass(false)} onClick={fillSample} disabled={submitting}>
            <MapPin aria-hidden size={14} />
            Try an address
          </button>
          {SITUATION_CHIPS.map((chip) => (
            <button
              type="button"
              className={chipClass(situation === chip.value)}
              onClick={() => toggleSituation(chip.value)}
              aria-pressed={situation === chip.value}
              disabled={submitting}
              key={chip.value}
            >
              <MessageCircle aria-hidden size={14} />
              {chip.label}
            </button>
          ))}
        </div>
      </section>

      {initialChecks.length > 0 ? (
        <section className="grid gap-3" aria-label="Recent property checks">
          <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">Recent</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {initialChecks.map((check) => (
              <Link
                className="flex items-center gap-3 rounded-(--r-card) border border-(--line) bg-(--surface) p-3.5 shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-float motion-reduce:hover:translate-y-0"
                href={`/property-check/${check.id}`}
                key={check.id}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-(--r-card) bg-(--accent-tint) text-foreground">
                  <Building2 aria-hidden size={17} />
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <b className="truncate text-[13px] font-bold text-foreground">{check.address}</b>
                  <small className="truncate text-[11.5px] text-muted-foreground">
                    {formatDate(check.createdAt)}
                    {check.clientSituation !== "general"
                      ? ` · ${PROPERTY_CHECK_CLIENT_SITUATION_LABELS[check.clientSituation]}`
                      : ""}
                  </small>
                </span>
                <span
                  className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[10.5px] font-bold ${
                    check.status === "success" ? "bg-success-soft text-success" : "bg-(--surface-subtle) text-muted-foreground"
                  }`}
                >
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
