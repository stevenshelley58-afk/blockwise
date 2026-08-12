"use client";

import { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Publish UI — Phase 7.3
//
// Separate publish flow from the editor. Shows Feed/Story PNGs, copy,
// CTA, form preview, audience, budget, schedule. Freezes snapshot then
// creates Meta objects PAUSED. Separate activation action.
// ---------------------------------------------------------------------------

export interface PublishState {
  feedPngHash: string;
  storyPngHash: string;
  metaPrimaryText: string;
  metaHeadline: string;
  metaDescription: string;
  metaCta: string;
  formPreview: {
    name: string;
    formType: string;
    intro: string;
    contactFields: string[];
  } | null;
  colourMode: string;
  templateVersion: number;
}

export interface PublishUIProps {
  adId: string;
  state: PublishState | null;
  isLoading: boolean;
  issues: string[];
  onFreeze: () => void;
  onActivate: () => void;
  isFrozen: boolean;
  isPublished: boolean;
  error: string | null;
}

export function PublishUI({
  adId,
  state,
  isLoading,
  issues,
  onFreeze,
  onActivate,
  isFrozen,
  isPublished,
  error,
}: PublishUIProps) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-(--canvas)">
        <p className="text-muted-foreground">Loading publish state...</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center bg-(--canvas)">
        <p className="text-muted-foreground">No publish state available.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-(--canvas)">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-(--line) bg-(--surface) px-5">
        <h2 className="text-base font-semibold">Publish to Meta</h2>
        {isPublished ? (
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
            Paused on Meta
          </span>
        ) : isFrozen ? (
          <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-700">
            Ready — Paused on Meta
          </span>
        ) : null}
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Issues */}
        {issues.length > 0 && (
          <div className="mb-6 rounded-(--r-card) border border-yellow-200 bg-yellow-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-yellow-800">
              Fix before publishing
            </h3>
            <ul className="space-y-1">
              {issues.map((issue, i) => (
                <li key={i} className="text-sm text-yellow-700">• {issue}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Preview cards */}
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div className="rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Feed (1080×1350)
            </h3>
            <div className="aspect-[4/5] rounded bg-gray-100 flex items-center justify-center">
              <span className="text-xs text-muted-foreground truncate max-w-[80%]">
                {state.feedPngHash.slice(0, 16)}...
              </span>
            </div>
          </div>
          <div className="rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Story (1080×1920)
            </h3>
            <div className="aspect-[9/16] rounded bg-gray-100 flex items-center justify-center">
              <span className="text-xs text-muted-foreground truncate max-w-[80%]">
                {state.storyPngHash.slice(0, 16)}...
              </span>
            </div>
          </div>
        </div>

        {/* Copy + CTA */}
        <div className="mb-6 space-y-3 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="text-sm font-semibold">Meta Copy</h3>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Primary Text</span>
              <p className="mt-0.5">{state.metaPrimaryText || "(empty)"}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Headline</span>
              <p className="mt-0.5">{state.metaHeadline || "(empty)"}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Description</span>
              <p className="mt-0.5">{state.metaDescription || "(empty)"}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">CTA</span>
              <p className="mt-0.5 font-medium">{state.metaCta}</p>
            </div>
          </div>
        </div>

        {/* Form */}
        {state.formPreview && (
          <div className="mb-6 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
            <h3 className="text-sm font-semibold">Instant Form</h3>
            <p className="mt-1 text-sm">{state.formPreview.name}</p>
            <p className="text-xs text-muted-foreground">
              {state.formPreview.formType} · {state.formPreview.contactFields.length} fields
            </p>
            <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
              {state.formPreview.intro}
            </p>
          </div>
        )}

        {/* Meta info */}
        <div className="rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="text-sm font-semibold">Details</h3>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p>Template: v{state.templateVersion}</p>
            <p>Colours: {state.colourMode}</p>
            <p>Ad ID: {adId.slice(0, 8)}...</p>
            {isFrozen && <p className="text-green-600">Snapshot frozen</p>}
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <footer className="flex shrink-0 items-center justify-between border-t border-(--line) bg-(--surface) px-5 py-4">
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
        <div className="ml-auto flex gap-3">
          {!isFrozen && (
            <button
              onClick={onFreeze}
              disabled={issues.length > 0}
              className="rounded-(--r-control) bg-(--ui-primary) px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Freeze & Create PAUSED
            </button>
          )}
          {isFrozen && !isPublished && (
            <button
              onClick={onActivate}
              className="rounded-(--r-control) bg-green-600 px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            >
              Activate Campaign
            </button>
          )}
          {isPublished && (
            <span className="text-sm text-green-700 font-medium">
              Campaign is live on Meta
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
