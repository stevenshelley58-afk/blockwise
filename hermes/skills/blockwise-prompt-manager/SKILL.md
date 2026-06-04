# blockwise-prompt-manager

## Purpose

Manage versioned prompt templates and prompt sets for content skills.

## Responsibilities

- Load the active prompt for each skill.
- Create draft prompt versions without silently changing active runs.
- Activate, lock, rollback, and assign prompts to skills.
- Log every resolved prompt in `prompt_runs`.

## Constraints

- No production prompt is hardcoded in skill code.
- Prompt edits require explicit activation.

## Tools

- `blockwise.prompt_registry.load`
- `blockwise.prompt_registry.version`

