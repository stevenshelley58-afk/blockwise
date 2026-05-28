# blockwise-ad-classifier

**Status:** stub — to be implemented in Phase 8.

## Purpose

Read each new `ad_creative` and write a structured classification into
`ad_creatives.classification`. This is what powers:

- "show me all 'just sold' ads in 6020"
- "what hooks are working in Cottesloe this month"
- "find ads similar to this one"
- "generate me a fresh listing ad in the style this agent uses"

## Inputs

```json
{
  "ad_creative_id": "<uuid>",
  "force": false
}
```

Default trigger: a new `ad_creative` row is inserted by the ingestion
worker; a Postgres trigger or polling job picks it up and runs this skill.

## Outputs

- `research.ad_creatives.classification` (jsonb) — written via the
  ingestion worker.
- `research.agent_decisions` — one `ad_classification` decision per
  creative classified.

## Classification shape

```jsonc
{
  "type": "listing" | "brand" | "just_sold" | "open_home"
        | "recruitment" | "lead_magnet" | "appraisal" | "other",
  "hooks": ["scarcity", "social_proof", "fomo", "local_market", "..."],
  "tone": "professional" | "casual" | "urgent" | "aspirational" | "...",
  "style": "photo_focused" | "video_walkthrough" | "graphic_text"
         | "drone_shot" | "lifestyle" | "...",
  "target_signal": {
    "suburb": "Cottesloe" | null,
    "postcode": "6011" | null,
    "price_band": "1m-2m" | "2m+" | "sub-1m" | "rental" | null,
    "audience": "first_home_buyer" | "downsizer" | "investor"
              | "vendor" | "seller_lead" | null
  },
  "confidence": 0-100
}
```

## Prompt sketch

A small model (Haiku / GPT-4o-mini / Gemini Flash) is enough. The skill
takes the creative's headline, body, CTA, and primary image URL (the
model sees the image directly), plus the agency name and known postcode
service area, and returns the structured classification.

If confidence < 60, the skill writes the classification with status
flagged for re-classification next pass, and uses a stronger model on
retry.

## Tools

- `hermes.llm.complete` (model picker)
- `blockwise.ingest.upsert_classification`
- `hermes.write_decision`
