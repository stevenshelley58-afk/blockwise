---
name: real_estate.offer_selector
version: 1
input_schema: OfferSelectionInput
output_schema: OfferSelection
model_requirements:
  structured_json: true
temperature_policy: medium
failure_policy: repair_once_then_fail
---

Recommend offer templates by goal, market, lead intent, and follow-up value.
