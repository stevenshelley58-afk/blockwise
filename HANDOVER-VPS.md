# Progressive Onboarding Rollout — VPS Agent Handover

**Branch:** `codex/progressive-onboarding-rollout`
**Commit:** `ba170a7`
**Date:** 2026-07-27

---

## Context

The progressive onboarding rollout has been implemented and pushed to GitHub. All local verification passed:

- `npm run typecheck`: PASS
- `npm run test`: 938/938 PASS
- `npm run verify:hard-reset`: 29/29 PASS
- AdStudio template gate: 71 templates, 22 primary intents

The implementation is complete but requires final deployment steps that must run on the VPS or through production services.

---

## Required Completion Steps

### 1. Open Pull Request

Create a PR from `codex/progressive-onboarding-rollout` against `main`:

```bash
gh pr create \
  --base main \
  --head codex/progressive-onboarding-rollout \
  --title "feat: progressive onboarding rollout" \
  --body "See commit message for full implementation summary. Security hardening included. All local gates pass."
```

### 2. Apply Supabase Migrations

Nine new migrations must be applied to production:

```
202607270001_progressive_activation_credit_ledger.sql
20260727022000_progressive_billing_foundation.sql
20260727023000_meta_free_live_claim_registry.sql
20260727024000_onboarding_booking_foundation.sql
20260727025000_paid_team_seat_enforcement.sql
20260727026000_billing_event_security_hardening.sql
20260727028000_progressive_funnel_analytics.sql
20260727029000_verified_trial_workspace_bootstrap.sql
20260727030000_verified_workspace_invitations.sql
```

Apply via Supabase CLI or dashboard. Verify each migration completes without error.

### 3. Deploy to Vercel

Trigger a Vercel deployment for the branch. The production build exceeded the five-minute local timeout but produced no compiler errors. Confirm the Vercel build succeeds.

```bash
vercel deploy --prod
```

Or merge the PR and let Vercel auto-deploy.

### 4. Confirm Trigger.dev Task Registration

After deployment, verify that Trigger.dev tasks registered correctly:

- Check the Trigger.dev dashboard for the project
- Confirm `adstudio-generate` task is registered
- Look for any registration errors in deployment logs

### 5. Vercel Preview Inspection

Inspect the following routes at desktop (1440×900) and mobile (390×844, 320px reflow):

- `/` — homepage
- `/pricing` — pricing page
- `/signup` — signup flow
- `/self-serve` — self-serve dashboard
- `/onboarding` — onboarding wizard
- `/settings` — settings page
- `/booking` — booking page
- `/operator/customers` — operator customer queue

### 6. Feature Flag Status

**Keep `PROGRESSIVE_ONBOARDING_ENABLED` disabled** until:

- Provider configuration is complete (Stripe, Meta, Cal.com)
- Preview acceptance passes
- Manual smoke test of signup → trial → paid flow completes

---

## Known Incomplete Items

These analytics events were deliberately NOT wired (require authoritative server-side mutations):

- `cta_clicked`
- `email_submitted`
- `third_free_ad_completed`
- `meta_prompt_shown`
- `managed_inquiry`

Do not synthesize these from client events.

---

## Files Changed Summary

- 101 files changed
- 14,544 insertions
- 1,916 deletions

Key new modules:
- `src/lib/credits/` — trial and paid credit ledger
- `src/lib/billing/` — Stripe domain, offers, first-live-campaign
- `src/lib/booking/` — Cal.com integration
- `src/lib/activation/` — customer activation tracking
- `src/lib/analytics/` — progressive funnel
- `src/lib/auth/` — verified workspace bootstrap and invitations
- `src/app/(customer)/booking/` — booking UI
- `src/app/(operator)/operator/customers/` — operator tools
- `supabase/migrations/` — 9 new migrations

---

## Rollback Plan

If issues arise:

1. Revert the merge commit on `main`
2. Redeploy Vercel
3. Migrations are additive; they do not need rollback unless schema conflicts occur

---

## Contact

For questions about implementation details, refer to:
- Design spec: `docs/superpowers/specs/2026-07-27-progressive-onboarding-pricing-rollout-design.md`
- Rollout runbook: `docs/runbooks/progressive-onboarding-rollout.md`
