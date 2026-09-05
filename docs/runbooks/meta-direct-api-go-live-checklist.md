# Meta direct API go-live checklist (do not activate yet)

Status: **Deferred.** Blockwise currently publishes Meta ads manually through
verified partner access (`/connect-meta`). This checklist is for the later
switch to direct Marketing API publishing. It must NOT be activated while the
Meta app is in Development mode or before app review approval.

Current facts to re-verify before starting (Meta changes requirements often —
use current official Meta documentation):

- Meta App ID: `1366207442127664`
- Blockwise Meta Business ID: `3701213676688100`
- App status: **In development**; partner-assisted manual publishing is live.

## Checklist

### Meta business and app review
- [ ] Business verification completed for the Blockwise Meta Business
      Portfolio (`3701213676688100`).
- [ ] App Review submitted with the exact permissions requested (see below)
      and nothing extra.
- [ ] Reviewer test account prepared (a Business Portfolio with a Page, an ad
      account and, optionally, a linked Instagram professional account).
- [ ] Screencast demonstration video recorded showing the complete
      customer flow.
- [ ] App icon, category, privacy policy URL and public description set on
      the app dashboard.
- [ ] Data deletion instructions/callback registered and reachable.

### Facebook Login for Business
- [ ] Facebook Login for Business configured with the minimal permission set.
- [ ] Valid OAuth redirect URIs restricted to production origins
      (`https://blockwise.sale`).
- [ ] State parameter (CSRF) enforced on the OAuth round-trip.

### Marketing API permissions (minimum set)
- [ ] `ads_management`
- [ ] `business_management`
- [ ] `pages_show_list` (only if Page-level operations require it)
- [ ] `instagram_basic` (only if Instagram publishing is in scope)
- Re-verify against current Meta documentation; request only what the
  publishing path actually calls.

### Secrets and token handling
- [ ] App Secret stored only on the VPS private runtime env — never in Git,
      never in client bundles or build logs.
- [ ] User access tokens encrypted at rest in
      `private.provider_token_vault`, touched only via the
      `public.provider_token_vault_*` service-role RPCs.
- [ ] Token expiration, refresh (long-lived exchange) and revocation paths
      implemented and tested.
- [ ] Token invalidation handled when a customer removes partner/asset access
      in Meta.

### Code and infrastructure
- [ ] The Meta provider write gate flips from operator-assisted publishing to
      direct API publishing behind a config flag.
- [ ] OAuth callback route + account-selection UX implemented behind the same
      flag.
- [ ] `/connect-meta` customer flow updated to offer (not force) the direct
      connection once approval exists; partner-access flow retained as
      fallback.
- [ ] Rollback plan: flag off restores operator-assisted publishing.

### Migration and cutover
- [ ] Migration plan per workspace: manual publishing -> direct API, with
      customer notification.
- [ ] Development-to-Live mode transition completed after approval.
- [ ] Production smoke test on a real ad account before announcing.
- [ ] Monitor: publish success rate, token errors, permission errors.

## Related docs
- `docs/runbooks/meta-manual-publishing-handoff.md`
- `docs/runbooks/meta-partner-external-proof.md`
- `docs/plans/META-PARTNER-ASSISTED-CONNECTION.md`
