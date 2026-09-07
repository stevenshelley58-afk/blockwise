# Homepage preview FAQ — 7 September 2026

## Delivered

- Preview: https://blockwise.sale/homepage-preview/concept#faq
- Application revision: `32ff67e4f894de3ac387214c9cc51f40ef532b5d`.
- Image/container: `blockwise-homepage-preview:32ff67e4f894` / `blockwise-homepage-preview-32ff67e4f894`.
- Image ID: `sha256:8e34010305569dd77bd57bb46cbae52d3cfb023579af68574bbf6944bfa86f6f`.
- Source: `/projects/blockwise-homepage-faq-20260907`, branch `codex/homepage-faq-20260907`, based on the serving `bb1cdf2d` preview.

The heading is now FAQ and the subheading is unchanged. Account setup help is first. Existing answers are shorter and friendlier, and the separate-ad-spend answer explains customer ownership and retention of Meta ad data when leaving Blockwise. It deliberately does not promise export or retention of every category of Blockwise-hosted data. Additional conversion questions remain suggestions, not unconfirmed published promises.

This is a preview-only copy change. It reuses the existing FAQ fixture and native details controls; no new dependency, component, styling or integration was needed. The production homepage, runtime and data are unchanged.

## Verification

- `npm run check:nul`: passed.
- `npm run test`: 935 tests, 934 passed, zero failures, one existing root/unwritable-directory skip.
- `npm run typecheck`: passed.
- `npm run build`: passed with the preview flag, base path and exact compiled revision above.
- Git whitespace check passed; dependency install reported zero vulnerabilities.
- Candidate and routed HTTPS response verified the exact compiled revision, FAQ heading, retained subheading, ownership copy and noindex header.
- Chromium through the public HTTPS preview verified the heading, first question and both new/updated answers. Native FAQ expansion and the rendered desktop layout were inspected. No mobile-specific test is claimed for this copy-only change.
- Production-health verification still reports `6ee635b3416ee694badc3d5b8f2ea99a9981be13` ready.
- Logs are retained outside committed source under the worktree's `work/` directory.

## Rollback

The previous preview container remains available. Restore only its narrow route:

```sh
python3 scripts/vps/homepage-preview-route.py --upstream blockwise-homepage-preview-bb1cdf2d8e84:3000 --apply
```

The route utility preserves production routes and saves the current router configuration before changing the preview. The new container keeps the existing non-root, read-only, secret-free, internal-network posture. No product service, provider-write gate or shared Frank edge configuration was changed.
