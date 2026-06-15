"use client";

import { Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import type { AdRadarLocationPrediction } from "@/lib/research/ad-radar-google-locations";

type AdRadarLocationFormProps = {
  action?: string;
  buttonLabel: string;
  emptySearchTerm?: string;
  initialNote: string;
  initialValue: string;
  inputLabel?: string;
  isSubmitting?: boolean;
  onSearch?: (searchTerm: string) => void;
  placeholder: string;
  surface: "landing" | "research";
  useBestGuess?: boolean;
  useBestGuessAsPlaceholder?: boolean;
};

type AutocompletePayload = {
  predictions?: AdRadarLocationPrediction[];
  source?: "google" | "local" | "none";
};

type GuessPayload = {
  location?: {
    label?: string;
    source?: "ip" | "fallback";
  };
};

export function AdRadarLocationForm({
  action = "/ad-radar",
  buttonLabel,
  emptySearchTerm,
  initialNote,
  initialValue,
  inputLabel = "Search",
  isSubmitting = false,
  onSearch,
  placeholder,
  surface,
  useBestGuess = false,
  useBestGuessAsPlaceholder = false,
}: AdRadarLocationFormProps) {
  const listId = useId();
  const [value, setValue] = useState(initialValue);
  const [note, setNote] = useState(initialNote);
  const [placeholderText, setPlaceholderText] = useState(placeholder);
  const [fallbackSearchTerm, setFallbackSearchTerm] = useState(emptySearchTerm ?? initialValue);
  const [suggestions, setSuggestions] = useState<AdRadarLocationPrediction[]>([]);
  const [suggestionSource, setSuggestionSource] = useState<AutocompletePayload["source"]>("none");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const [sessionToken] = useState(createSessionToken);
  const userEditedRef = useRef(false);
  const isLanding = surface === "landing";
  const showSuggestions = isFocused && suggestions.length > 0;

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    setNote(initialNote);
  }, [initialNote]);

  useEffect(() => {
    setPlaceholderText(placeholder);
  }, [placeholder]);

  useEffect(() => {
    setFallbackSearchTerm(emptySearchTerm ?? initialValue);
  }, [emptySearchTerm, initialValue]);

  useEffect(() => {
    if (!useBestGuess) return;

    let cancelled = false;
    void fetch("/api/research/locations/guess")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: GuessPayload | null) => {
        if (cancelled || userEditedRef.current) return;
        const label = payload?.location?.label?.trim();
        if (!label) return;

        setFallbackSearchTerm(label);
        if (useBestGuessAsPlaceholder) {
          setPlaceholderText(label);
        } else {
          setValue(label);
        }
        setNote(`Best guess: ${label}. Scan to see scraped ads for this area.`);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [useBestGuess, useBestGuessAsPlaceholder]);

  useEffect(() => {
    const query = value.trim();
    setActiveIndex(-1);

    if (!isFocused || query.length < 2) {
      setSuggestions([]);
      setSuggestionSource("none");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query, session: sessionToken });
      void fetch(`/api/research/locations/autocomplete?${params.toString()}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: AutocompletePayload | null) => {
          if (controller.signal.aborted) return;
          setSuggestions(payload?.predictions ?? []);
          setSuggestionSource(payload?.source ?? "none");
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSuggestions([]);
            setSuggestionSource("none");
          }
        });
    }, 120);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isFocused, sessionToken, value]);

  function onChange(nextValue: string) {
    userEditedRef.current = true;
    setValue(nextValue);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      chooseSuggestion(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      setSuggestions([]);
      setIsFocused(false);
    }
  }

  function chooseSuggestion(suggestion: AdRadarLocationPrediction) {
    userEditedRef.current = true;
    setValue(suggestion.searchTerm);
    setSuggestions([]);
    submitSearch(suggestion.searchTerm);
  }

  function submitSearch(searchTerm: string) {
    const trimmed = searchTerm.trim() || (onSearch ? fallbackSearchTerm.trim() : "");
    if (onSearch) {
      if (trimmed) onSearch(trimmed);
      return;
    }

    navigateToSearch(trimmed);
  }

  function navigateToSearch(searchTerm: string) {
    if (typeof window === "undefined") return;
    const url = new URL(action, window.location.origin);
    if (searchTerm.trim()) url.searchParams.set("q", searchTerm.trim());
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <form
      className={isLanding ? "lp-location-form" : "research-search-form research-location-form"}
      action={action}
      onSubmit={
        onSearch
          ? (event) => {
              event.preventDefault();
              submitSearch(value);
            }
          : undefined
      }
    >
      <label className={isLanding ? "lp-location-field" : undefined} htmlFor={`${listId}-input`}>
        <span className={isLanding ? "sr-only" : undefined}>{inputLabel}</span>
        <span className={isLanding ? "lp-location-pill" : "research-location-field"}>
          <input
            id={`${listId}-input`}
            name="q"
            value={value}
            placeholder={placeholderText}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={`${listId}-list`}
            aria-expanded={showSuggestions}
            onBlur={() => window.setTimeout(() => setIsFocused(false), 120)}
            onChange={(event) => onChange(event.target.value)}
            onFocus={() => setIsFocused(true)}
            onKeyDown={onKeyDown}
          />
          <Search size={isLanding ? 18 : 14} aria-hidden />
        </span>
      </label>

      {showSuggestions ? (
        <div
          id={`${listId}-list`}
          className={isLanding ? "lp-location-suggestions" : "research-location-suggestions"}
          role="listbox"
          onMouseDown={(event) => event.preventDefault()}
        >
          {suggestions.map((suggestion, index) => (
            <button
              aria-selected={index === activeIndex}
              className={isLanding ? "lp-location-option" : "research-location-option"}
              key={`${suggestion.source}:${suggestion.placeId ?? suggestion.searchTerm}`}
              onClick={() => chooseSuggestion(suggestion)}
              role="option"
              type="button"
            >
              <strong>{suggestion.mainText}</strong>
              {suggestion.secondaryText ? <span>{suggestion.secondaryText}</span> : null}
            </button>
          ))}
          {suggestionSource === "google" ? <span className={isLanding ? "lp-location-powered" : "research-location-powered"}>Powered by Google</span> : null}
        </div>
      ) : null}

      {note ? <p className={isLanding ? "lp-radar-note" : "research-location-note"}>{note}</p> : null}
      <button className={isLanding ? "lp-btn lp-btn-primary lp-btn-wide" : "button"} disabled={isSubmitting} type="submit">
        <Search size={14} aria-hidden />
        {isSubmitting ? "Scanning..." : buttonLabel}
      </button>
    </form>
  );
}

function createSessionToken(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
