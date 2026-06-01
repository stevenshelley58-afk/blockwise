---
name: brand.tone_extractor
version: 1
input_schema: BrandCopySamples
output_schema: BrandTone
model_requirements:
  structured_json: true
temperature_policy: low
failure_policy: repair_once_then_fail
---

Summarize the brand voice and phrases to prefer or avoid.
