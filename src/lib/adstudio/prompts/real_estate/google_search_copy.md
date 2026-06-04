---
name: real_estate.google_search_copy
version: 1
input_schema: GoogleSearchCopyInput
output_schema: GoogleSearchPack
model_requirements:
  structured_json: true
temperature_policy: medium
failure_policy: repair_once_then_fail
---

Generate Google Responsive Search Ad copy. Platform character limits are validated outside this prompt.
