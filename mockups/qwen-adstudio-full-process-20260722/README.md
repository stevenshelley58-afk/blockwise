# Qwen AdStudio full-process test — 2026-07-22

Decision: **quarantined; do not publish**.

This directory records a full AdStudio template trial using one real source ad,
Qwen vision analysis, safe generic replacement assets, a public-sample render,
and a customer render using the supplied property photo and Blockwise icon.

## Source and contract

- Source: `meta_ad_candidates/02_stories_reels_9x16/meta_293.png`
- Source SHA-256: `3d3e12dff0ba6a91edf2004767eb9d9985a1f6468e63d40b057c6b626e6a7539`
- Qwen vision model: `qwen3-vl-plus`
- Declared customer images: property photo, agency logo
- Declared text: headline, property address, phone number, website
- Intended customer copy: `JUST LISTED`, `SPEARWOOD, WA 6163`,
  `08 6102 1840`, `BLOCKWISE.SALE`

`02-template.json` is the pre-QA candidate manifest. Its `approved` status is the
creator-script default and is superseded by `13-manual-qa.json`; the candidate
was never added to the production template registry.

## Results

| Model | Public sample | Customer ad | Decision |
| --- | --- | --- | --- |
| `qwen-image-2.0-pro` | Preserved layout and generic house, but retained `REALLYGREATSITE` and malformed the generic logo | Kept the generic house instead of the supplied house, retained source identity, and altered the Blockwise logo | Fail |
| `qwen-image-edit-max` | Reinterpreted the layout, ignored the generic inputs, and malformed safe copy | Used the supplied house, but changed the layout/logo and garbled address, phone, and website | Fail |

The automated Qwen visual-QA output also produced material false positives.
`13-manual-qa.json` is the authoritative assessment.

## Gallery preview

`10-website-template-preview.html` is an isolated, test-only rendering of where
the candidate card would appear. It deliberately labels the card `QA FAILED`,
disables its action, and does not modify the Blockwise application.

- Desktop capture: `11-website-template-desktop.png` at 1440×900
- Mobile capture: `12-website-template-mobile.png` at 390×844

No API key or other secret is stored in this directory.
