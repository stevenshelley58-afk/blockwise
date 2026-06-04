# Meta Ad Library Card Contract

Date: 2026-05-30

This document defines the card data contract only. It does not change app UI.

## Required Card Fields

| Card field | Source contract |
| --- | --- |
| Advertiser name | Resolved advertiser page or linked agency |
| Advertiser URL | Meta page URL when known |
| Library ID | External Meta ad id |
| Active status | Normalized observed ad status |
| Started running | Delivery start date |
| Stopped running | Delivery stop date when available |
| Platforms | Meta publisher platforms |
| Primary text | Creative body |
| Headline | Creative headline |
| Description | Creative description when available |
| CTA | Creative CTA label |
| Destination | Landing URL or CTA URL |
| Media | Durable bucket asset first, provider URL fallback |
| Classification | Ad type, intent, hooks, tone, confidence |
| Evidence | Snapshot or raw evidence pointer for operator review |

## Rendering Rules

1. Prefer stored media over provider hotlinks.
2. Do not render a page unless the real-estate gate passes.
3. Show missing fields as absent data, not invented summaries.
4. Keep Library ID visible for operator traceability.
5. Separate active status from classification confidence.
6. Keep external links explicit and safe to open in a new tab.

## Non-Goals

The card should not expose service-role data, raw cookies, provider credentials,
or unredacted operator notes.

## Acceptance Checklist

1. Every visible card maps back to a raw evidence record.
2. Every card belongs to a verified real-estate advertiser.
3. Media still renders if provider URLs expire, when stored media exists.
4. Empty classification does not hide the ad, but it is marked incomplete for
   operator follow-up.
