# Codex Plan: Remove Paid Cloud Browser Provider

Date: 2026-06-07

Goal: replace the paid cloud browser runtime with an internal Steel CDP sidecar
and the Chromium fallback already present in the Hermes image. Steel must stay
on the internal `research` Docker network, with no public bindings for ports
`3000` or `9223`.

Implementation status:

- Supervisor browser rendering uses `HERMES_REMOTE_BROWSER_CDP_URL` first when
  configured, then cools the sidecar path down on failure and falls back to
  local Chromium.
- The Coolify research compose file adds `steel` with a pinned image supplied by
  `STEEL_IMAGE`.
- Hermes config no longer enables the paid cloud browser tool.
- Skills and docs refer to self-hosted browser sessions.
- Verification should include the repo-wide provider-name search, research
  tests, typecheck, compose config validation with `STEEL_IMAGE` set, and a
  check that Steel ports are not host-published.

Known trade-off: the previous paid provider supplied anti-blocking features.
The VPS-hosted browser may be blocked by some public sites. Keep the existing
cooldown and defect-filing path; evaluate a self-hosted anti-detection browser
later if block rates justify it.
