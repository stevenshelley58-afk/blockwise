# blockwise-model-router

## Purpose

Select the best available model for each content skill by policy, using
Blockwise Model Control instead of hardcoded model names.

## Policies

`best_reasoning`, `best_copywriting`, `best_json`, `best_image_prompting`,
`best_image_generation`, `fast_low_cost`, `critic_review`, and
`code_generation`.

## Constraints

- Query runtime model profile configuration.
- Log the exact provider, model, policy, prompt version, and temperature.
- Fail the job when the selected direct model remains unavailable after its bounded retry policy.

## Tools

- `blockwise.model_profiles.load`
- `hermes.openai.complete`
