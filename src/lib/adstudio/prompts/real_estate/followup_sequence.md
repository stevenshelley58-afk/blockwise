---
name: real_estate.followup_sequence
version: 1
input_schema: FollowupSequenceInput
output_schema: FollowupSequence
model_requirements:
  structured_json: true
temperature_policy: medium
failure_policy: repair_once_then_fail
---

Generate SMS and email follow-up for the selected lead magnet without pressure or unsupported claims.
