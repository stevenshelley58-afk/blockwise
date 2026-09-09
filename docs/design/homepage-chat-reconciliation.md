# Homepage chat reconciliation, 7 September 2026

## Correction

The owner rejected the earlier consolidation because it removed sections and invented a replacement editing section. This record supersedes the structural decisions in the rejected `9ec3604a` / `f899d681` preview and its completion record. The correction starts from the unmodified latest combined hero/reporting/FAQ implementation at `e69e4d78`, not from that rejected consolidation.

## Conversation evidence

The relevant homepage conversations were read through their user instructions, including the archived hero conversation. Generic VPS conversations were checked for homepage work; pricing-page and template-generator instructions were not treated as permission to add homepage sections.

| Conversation | Authority retained |
| --- | --- |
| Plan homepage conversion rebuild (`01a07725-c15e-7e91-8c77-acf342015a4e`) | Core app explanation and clear CTAs first, useful deeper information retained. Owner rejected the short-page plan. Mobile and desktop; email form; no Property Check. |
| Redesign app explanation section (`01a07a6a-496b-7732-b487-41007244d255`) | Full templates, selection, shared-image handoff, editing, review values and green approval sequence. Later native Meta ad gallery moves into the hero; it does not replace the separate workflow. |
| Redesign ad preview hero (`01a07a79-4bad-7002-ac29-aaf97145b80a`) | Follow-up workflow refinements: distinct ad, obvious creative-text editing, continuous looping, smoother handoffs, no replay button or extra explainer text. |
| Redesign homepage value section (`01a07a73-5606-7823-9137-d0e144f6f623`) | Separate personal dashboard and optional email benefit. Preserve the approved headline/copy and chart. Remove only the extra email-control/card subsection. |
| Fix X-axis day display (`01a07afd-c6c3-7812-bcc5-5fe782b74071`) | Legible day labels, smooth line/fill reveal together, replay on scroll entry and period switch. |
| Homepage FAQ task (`01a07a8f-9459-7692-9acc-beaa82d947bc`) | FAQ heading and exact retained subheading. Six concise answers, setup help first, own Meta spend/data, self-managed continuation after trial. |
| Redesign Blockwise hero section, archived (`01a04c9f-98b0-7641-9192-d0a47bbea0a7`) | Log in text on mobile and desktop. Older dashboard hero is superseded by the newer Meta gallery. |
| Pricing-page task (`01a07aa3-06fd-70f3-ac7d-d5f0c3dd7d5e`) | Separate pricing work, not a new homepage pricing section. Preserve the existing Pricing link. |

## Required page order and source

1. Hero: latest native Feed/Story ad loop and approved competition headline from `e69e4d78`.
2. Workflow: restore the existing complete product demonstration from `/srv/blockwise/e2e-runs/process-explainer-20260907`, with the previously requested green approval finish restored. No new stand-alone naked typing ad.
3. Results: exact latest reporting component and fixtures from `e69e4d78`.
4. Examples: original objective tabs, full ad preview and collapsible product details from `e69e4d78`.
5. Control: original creative/budget/campaign/updates accordions from `e69e4d78`.
6. FAQ: all six existing answers plus `What to expect before you start.` from `e69e4d78`.
7. Trial: original email form and footer, with a hydration guard preventing a native no-JavaScript form submission.

No new claims, sections, pricing tiers, provider behavior or imagery are invented. Existing assets and components are reused. The workflow photo changes only to satisfy the recorded distinct-ad request. Required control labels, product facts, accessibility text and the explicitly retained FAQ subheading remain. Existing copy is not rewritten as a substitute for restoring the correct structure.

## Boundary and verification

Preview only at `/homepage-preview/concept`. Fake form and fake campaign approval. No production product deployment, credentials, persistence or provider requests. Existing framework, motion library, assets and preview container/router tooling suffice; no new dependency is needed. Release evidence is recorded separately after checks and live verification.

## Workflow refinement, 8 September 2026

The owner retained the stage progression but rejected the restored animation's transitions, oversized creative text and disappearing template rail. The [continuous-studio rebuild](../releases/2026-09-08-homepage-workflow-continuity.md) supersedes that workflow implementation only. The established seven-section page structure is unchanged.
