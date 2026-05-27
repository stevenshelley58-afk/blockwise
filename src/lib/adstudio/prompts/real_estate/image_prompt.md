---
name: real_estate.image_prompt
version: 1
input_schema: ImagePromptInput
output_schema: ImagePromptSet
model_requirements:
  structured_json: true
temperature_policy: medium
failure_policy: repair_once_then_fail
---

Generate background and style prompts only. Do not include final ad text in the image prompt.
