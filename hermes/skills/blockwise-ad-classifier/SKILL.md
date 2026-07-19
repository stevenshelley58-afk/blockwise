# blockwise-ad-classifier

## Purpose

Classify each captured real-estate creative so the app can filter by ad type,
hook, style, audience, and local target signal.

## Input

```json
{
  "adCreativeId": "<research.ad_creatives.id>",
  "sourceDocumentId": "<source_documents.id>",
  "force": false
}
```

## Model Config

Use the `hermes/tools/research-runtime` direct OpenAI client. Model names must come
from env only:

```bash
OPENAI_API_KEY=<key>
HERMES_DEFAULT_MODEL=gpt-5.5
HERMES_MODELS_JSON={"ad_classification":"<model-from-operator-config>"}
```

Do not hardcode model names in prompts, scripts, or skill config.

## Classification Shape

Return only JSON matching the supplied schema. No Markdown, comments, JSONC, or
extra keys. If parsing fails, repair_once_then_fail and open a defect if the
second attempt is invalid.

```json
{
  "isRealEstateAd": true,
  "realEstateRelevance": "agent_brand",
  "adType": "appraisal",
  "primaryIntent": "generate_appraisals",
  "propertyOrAgentFocus": "agency",
  "hooks": [],
  "tone": "",
  "style": "",
  "audience": "",
  "suburbSignals": [],
  "confidence": 0,
  "rejectionReason": null
}
```

## Output Rules

- Write `research.ad_creatives.classification`, `ad_type`, and
  `primary_intent` through the ingestion API.
- Write one `ad_classification` decision per creative with prompt version,
  configured model id, cost trace, evidence, and confidence.
- If relevance is `not_real_estate` or confidence is below the threshold, flag
  the creative for review and open a defect against the upstream resolver or
  census path.
- Do not delete or hide ads directly; classification only supplies a secondary
  relevance signal.

## Tools

- `hermes/tools/research-runtime`
- `hermes.openai.complete`
- `blockwise.ingest.upsert_classification`
- `blockwise.ingest.open_defect`
- `hermes.write_decision`
