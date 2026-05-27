---
name: real_estate.google_pmax_copy
version: 1
input_schema: GoogleAssetCopyInput
output_schema: GoogleAssetPack
model_requirements:
  structured_json: true
temperature_policy: medium
failure_policy: repair_once_then_fail
---

Generate Performance Max and Demand Gen copy and asset direction.
