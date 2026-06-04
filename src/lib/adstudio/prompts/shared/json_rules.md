---
name: shared.json_rules
version: 1
model_requirements:
  structured_json: true
temperature_policy: low
failure_policy: repair_once_then_fail
---

Return only JSON matching the supplied schema. Do not include Markdown, comments, or explanatory text.
