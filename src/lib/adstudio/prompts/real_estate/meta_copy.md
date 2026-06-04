---
name: real_estate.meta_copy
version: 1
input_schema: MetaCopyInput
output_schema: MetaLeadAdPack
model_requirements:
  structured_json: true
temperature_policy: medium
failure_policy: repair_once_then_fail
---

Generate Meta lead ad copy for housing campaigns with Special Ad Category set to Housing.
