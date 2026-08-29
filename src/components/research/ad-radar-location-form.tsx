"use client";

import { MapPin, Search, Users } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { niche } from "@/config/niche";
import type { AdRadarSearchSuggestion } from "@/lib/research/ad-radar-search-suggestions";

type AdRadarLocationFormProps = {
  action?: string;
  buttonLabel: string;
  emptySearchTerm?: string;
  initialNote: string;
  initialValue: string;
  inputLabel?: string;
  isSubmitting?: boolean;
  onEmptySearch?: () => void;
  onSearch?: (searchTerm: string) => void;
  placeholder: string;
  surface: "landing" | "research";
  useBestGuess?: boolean;
  useBestGuessAsPlaceholder?: boolean;
};

type AutocompletePayload = {
  suggestions?: AdRadarSearchSuggestion[];
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
  onEmptySearch,
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
  const [suggestions, setSuggestions] = useState<AdRadarSearchSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const [sessionToken] = useState(createSessionToken);
  const userEditedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
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
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query, session: sessionToken });
      void fetch(`/api/research/ad-radar/suggestions?${params.toString()}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: AutocompletePayload | null) => {
          if (controller.signal.aborted) return;
          setSuggestions(payload?.suggestions ?? []);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSuggestions([]);
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

  function chooseSuggestion(suggestion: AdRadarSearchSuggestion) {
    userEditedRef.current = true;
    setValue(suggestion.searchTerm);
    setSuggestions([]);
    submitSearch(suggestion.searchTerm);
  }

  function submitSearch(searchTerm: string) {
    const trimmed = searchTerm.trim() || (onSearch ? fallbackSearchTerm.trim() : "");
    if (onSearch) {
      if (trimmed) onSearch(trimmed);
      else {
        onEmptySearch?.();
        inputRef.current?.focus();
      }
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
      className={isLanding ? "lp-location-form" : "relative flex w-full flex-wrap items-end gap-2.5"}
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
      <label
        className={isLanding ? "lp-location-field" : "grid min-w-[min(100%,260px)] flex-1 gap-1.5"}
        htmlFor={`${listId}-input`}
      >
        <span
          className={
            isLanding ? "sr-only" : "font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase"
          }
        >
          {inputLabel}
        </span>
        <span
          className={
            isLanding
              ? "lp-location-pill"
              : "flex h-11 items-center gap-2 rounded-(--r-card) border border-(--line) bg-(--surface) px-3 transition-[border-color,box-shadow] duration-150 focus-within:border-(--ink) focus-within:shadow-card"
          }
        >
          <input
            id={`${listId}-input`}
            ref={inputRef}
            name="q"
            value={value}
            placeholder={placeholderText}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={`${listId}-list`}
            aria-describedby={`${listId}-scope${note ? ` ${listId}-note` : ""}`}
            aria-expanded={showSuggestions}
            aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
            onBlur={() => window.setTimeout(() => setIsFocused(false), 120)}
            onChange={(event) => onChange(event.target.value)}
            onFocus={() => setIsFocused(true)}
            onKeyDown={onKeyDown}
            className={
              isLanding
                ? undefined
                : "min-w-0 flex-1 border-0 bg-transparent p-0 text-[13.5px] font-semibold outline-none placeholder:text-(--faint)"
            }
          />
          <Search size={isLanding ? 18 : 15} aria-hidden className={isLanding ? undefined : "shrink-0 text-(--faint)"} />
        </span>
      </label>

      {showSuggestions ? (
        <div
          id={`${listId}-list`}
          className={
            isLanding
              ? "lp-location-suggestions"
              : "absolute top-[68px] left-0 z-20 w-full max-w-[560px] overflow-hidden rounded-(--r-card) border border-(--line) bg-(--surface) shadow-float"
          }
          role="listbox"
          onMouseDown={(event) => event.preventDefault()}
        >
          {suggestions.map((suggestion, index) => (
            <button
              aria-selected={index === activeIndex}
              className={
                isLanding
                  ? "lp-location-option"
                  : "grid w-full cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-[9px] border-0 bg-(--surface) px-3 py-2.5 text-left transition-colors duration-100 hover:bg-(--surface-subtle) aria-selected:bg-(--surface-subtle)"
              }
              id={`${listId}-option-${index}`}
              key={suggestion.id}
              onClick={() => chooseSuggestion(suggestion)}
              role="option"
              type="button"
            >
              <span
                className={
                  isLanding
                    ? "ad-radar-suggestion-icon"
                    : "inline-grid size-7 place-items-center rounded-lg bg-(--surface-subtle) text-foreground"
                }
                aria-hidden
              >
                {suggestion.kind === "location" ? <MapPin size={15} /> : <Users size={15} />}
              </span>
              <span className={isLanding ? "ad-radar-suggestion-copy" : "grid min-w-0 gap-0.5"}>
                <strong className={isLanding ? undefined : "truncate text-[13.5px] font-bold text-foreground"}>
                  {suggestion.mainText}
                </strong>
                <span className={isLanding ? undefined : "truncate text-xs text-muted-foreground"}>
                  {suggestion.secondaryText}
                </span>
              </span>
              <span
                className={
                  isLanding
                    ? "ad-radar-suggestion-kind"
                    : "text-[10.5px] font-bold tracking-[0.08em] text-(--faint) uppercase"
                }
              >
                {suggestion.kind === "location" ? "Place" : "Advertiser"}
              </span>
            </button>
          ))}
          {suggestions.some((suggestion) => suggestion.source === "google") ? (
            <span
              className={
                isLanding
                  ? "lp-location-powered"
                  : "block border-t border-(--line) px-3 pt-[7px] pb-[9px] text-right text-[10.5px] font-bold text-(--faint)"
              }
            >
              Location suggestions powered by Google
            </span>
          ) : null}
        </div>
      ) : null}

      <p
        id={`${listId}-scope`}
        className={isLanding ? "lp-search-scope" : "sr-only"}
      >
        {niche.copy.adRadar.searchScope}
      </p>
      {note ? (
        <p id={`${listId}-note`} className={isLanding ? "lp-radar-note" : "basis-full text-xs text-muted-foreground"}>
          {note}
        </p>
      ) : null}
      <button
        className={
          isLanding
            ? "lp-btn lp-btn-primary lp-btn-wide"
            : "inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-(--ink) px-5 text-[13px] font-bold text-white transition-[opacity,transform] duration-150 hover:opacity-85 active:scale-[0.97] disabled:cursor-default disabled:opacity-50"
        }
        disabled={isSubmitting}
        type="submit"
      >
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
