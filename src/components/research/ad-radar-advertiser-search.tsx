"use client";

import { Users } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import type { AdvertiserSuggestion } from "@/lib/research/advertiser-autocomplete";

type Props = {
  onSelect: (advertiser: AdvertiserSuggestion) => void;
};

type AutocompletePayload = { advertisers?: AdvertiserSuggestion[] };

/**
 * Predictive search across the full list of advertiser pages (agents/agencies).
 * Unlike the free-text ad search, this matches the typed term against known
 * advertiser names and runs an exact lookup once one is chosen.
 */
export function AdRadarAdvertiserSearch({ onSelect }: Props) {
  const listId = useId();
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<AdvertiserSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const justSelectedRef = useRef(false);
  const showSuggestions = isFocused && suggestions.length > 0;

  useEffect(() => {
    const query = value.trim();
    setActiveIndex(-1);

    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }

    if (!isFocused || query.length < 2) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query });
      void fetch(`/api/research/advertisers/autocomplete?${params.toString()}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: AutocompletePayload | null) => {
          if (controller.signal.aborted) return;
          setSuggestions(payload?.advertisers ?? []);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions([]);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isFocused, value]);

  function chooseSuggestion(suggestion: AdvertiserSuggestion) {
    justSelectedRef.current = true;
    setValue(suggestion.pageName);
    setSuggestions([]);
    setActiveIndex(-1);
    onSelect(suggestion);
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

  return (
    <div className="research-advertiser-search">
      <label htmlFor={`${listId}-input`}>
        <span className="research-advertiser-search-label">Search by agency or agent</span>
        <span className="research-location-field">
          <Users size={14} aria-hidden />
          <input
            id={`${listId}-input`}
            value={value}
            placeholder="Ray White, Harcourts, an agent's name..."
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={`${listId}-list`}
            aria-expanded={showSuggestions}
            onBlur={() => window.setTimeout(() => setIsFocused(false), 120)}
            onChange={(event) => setValue(event.target.value)}
            onFocus={() => setIsFocused(true)}
            onKeyDown={onKeyDown}
          />
        </span>
      </label>

      {showSuggestions ? (
        <div
          id={`${listId}-list`}
          className="research-location-suggestions research-advertiser-suggestions"
          role="listbox"
          onMouseDown={(event) => event.preventDefault()}
        >
          {suggestions.map((suggestion, index) => (
            <button
              aria-selected={index === activeIndex}
              className="research-location-option research-advertiser-option"
              key={suggestion.pageId ?? suggestion.pageName}
              onClick={() => chooseSuggestion(suggestion)}
              role="option"
              type="button"
            >
              {suggestion.pageImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" className="research-advertiser-avatar" src={suggestion.pageImageUrl} />
              ) : (
                <span className="research-advertiser-avatar research-advertiser-avatar-fallback" aria-hidden>
                  <Users size={13} />
                </span>
              )}
              <strong>{suggestion.pageName}</strong>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
