# Research Engine Data Contracts

Date: 2026-05-30

These contracts define the expected data boundaries after the hard reset. The
database schema remains owned by Supabase migrations outside this task.

## Entity Contract

| Entity | Required identifiers | Required provenance |
| --- | --- | --- |
| Agency | Internal id, name, state or service area | Source document and decision before `is_real_estate = true` |
| Agent | Internal id, agency id when known, name | Source document and decision before trust |
| Advertiser page | Meta page id or URL, page name, linked agent or agency | Resolver decision with confidence |
| Observed ad | Advertiser page id, external Meta ad id | Fetch run id and raw snapshot |
| Creative | Observed ad id, format, headline/body/CTA when available | Normalized source payload and media references |
| Classification | Creative id, type, intent, confidence | Classifier decision and model metadata |

## Eligibility Contract

Only pages linked to verified real-estate agencies or agents are eligible for
routine collection and display. V1 does not use location search, postcode
search, suburb search, ad-first search, or generic advertiser discovery as a
hint source. The only allowed path is verified roster to verified Meta page to
collection by page id.

## Collection Contract

| Condition | Required handling |
| --- | --- |
| Provider timeout | Failed run, no absence changes |
| Login wall or checkpoint | Failed run, no absence changes |
| Empty successful result | Record successful run; absence still needs repeated misses |
| New external ad id | Insert observed ad and snapshot |
| Existing external ad id | Update status and add snapshot |
| Media found | Store durable bucket reference |
| Media missing | Keep raw evidence and mark the creative incomplete |

## Decision Contract

Every AI or skill decision must include:

1. Decision type.
2. Subject id.
3. Skill name and version when available.
4. Model name when a model was used.
5. Confidence.
6. Short rationale.
7. Source document ids or raw evidence pointers.

## App-Facing Contract

The app should read from `research.v_*` views, not raw ingestion tables. Views
must preserve the real-estate gate and return media references that can be
rendered without exposing secrets.

## Storage Contract

| Bucket | Purpose |
| --- | --- |
| `research-raw-evidence` | Raw provider payloads and fetch evidence |
| `research-ad-creatives` | Renderable ad images, videos, and thumbnails |
| `research-screenshots` | Browser or page evidence screenshots |

Storage paths must be deterministic enough to avoid duplicate blobs for the
same provider asset.
