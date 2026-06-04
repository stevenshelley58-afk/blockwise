---
name: brand.website_brand_extractor
version: 1
input_schema: ExtractBrandKitInput
output_schema: AdStudioBrandKit
model_requirements:
  structured_json: true
  vision_input: true
temperature_policy: low
failure_policy: repair_once_then_fail
eval_rules:
  - Extract identity, colours, typography, tone, assets, and compliance disclaimers separately.
---

Extract a reusable brand kit from website HTML, screenshots, and public assets.
