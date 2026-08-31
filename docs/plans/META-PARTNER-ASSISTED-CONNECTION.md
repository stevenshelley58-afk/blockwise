# Meta Partner-Assisted Connection — Implementation Blueprint

- Status: implementation-ready only after Prerequisite A and Step 0 pass
- Target branch: fresh feature branches from `origin/main`
- Plan owner: Blockwise
- Primary surface: `/connect-meta`
- Visitor mode: Operate
- Temporary connection mode: Meta Business Portfolio partner access
- Permanent connection mode: customer OAuth after Meta App Review / Marketing API access approval

### Controlling execution authority

The repository currently contains a real contradiction: root `AGENTS.md` still
names Vercel Preview as the acceptance runtime, while the newer, owner-approved
2026-08-29 runbooks (`docs/runbooks/production-readiness.md`,
`docs/runbooks/oss-product-migration.md`, and `docs/runbooks/rollback.md`) name
the self-hosted product VPS/Caddy stack as the product target and mark Vercel
material historical. For this blueprint, the newer owner-approved product
target controls: runtime acceptance happens on an isolated controlled VPS
staging hostname, then the controlled production VPS hostname. Localhost and a
historical Vercel project are not acceptance.

**Prerequisite A is mandatory:** before product implementation, update the
acceptance paragraph in root `AGENTS.md` to the self-hosted target, with links
to those three runbooks. Until that authority-reconciliation PR merges, stop;
do not make runtime or UI PRs under conflicting instructions.

Every migration added by this plan must also be added in chronological order to
`infra/product/product-migrations.txt`. Every runtime setting added by this plan
must be documented in `infra/product/.env.example` and passed explicitly by
`infra/coolify/docker-compose.product.yml`. Root `.env.example` remains a
developer-facing inventory only.

## 1. Objective

Ship a safe, understandable, operator-assisted way for an owner or admin of a
customer workspace to share a Meta ad account, Facebook Page, and optional
Instagram professional account with Blockwise while the normal customer OAuth
path is awaiting Meta approval.

The experience must let a non-technical customer:

1. open the correct Meta Business Settings page;
2. copy Blockwise's Business ID;
3. follow real Meta screenshots to share the correct assets and partial-access
   permissions;
4. tell Blockwise that the share is complete;
5. wait while a Blockwise operator verifies and binds the assets to exactly one
   workspace;
6. confirm the names of the assets Blockwise found;
7. select an optional Instagram identity and finish required publishing setup;
8. arrive at an honest `Connected` or `Connected — setup required` state.

This plan completes and hardens the partner-access implementation already on
`main`. It does not replace the existing publish, reporting, lead-sync, asset,
or token-vault pipelines.

## 2. Mandatory platform warning and go/no-go rule

Partner sharing is not proof that Meta will permit an unapproved app to manage
another business's account. Meta's current public Marketing API material says
that an app managing other people's ad accounts requires the upper Marketing
API Access Tier: **Full Access** (called Advanced Access before Meta's May 4,
2026 terminology change). This platform tier is distinct from the
`ads_management` permission. Therefore, Step 0 is a release blocker and may
prove that this interim path is impossible until Meta approval.

The implementation agent must not:

- state that the workaround definitely avoids App Review;
- expose the partner flow to paying customers before the external-account test
  passes;
- weaken Meta errors into a false `Connected` state;
- substitute a developer/app-role account for the external test business;
- continue past Step 0 if Meta rejects the system-user token because of app
  access level, business verification, or permission tier.

If Step 0 fails, stop the automated partner-connection project. Keep OAuth work
continuing through App Review and change the interim customer offer to creative
export plus explicitly manual/operator publishing. Do not disguise manual work
as an API connection.

Current reference material:

- Meta's Marketing API Postman collection:
  <https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi>
- Meta's May 2026 Marketing API Access Tier announcement:
  <https://developers.meta.com/blog/updates-to-ads-management-standard-access-feature/>
- Meta's Instagram API Postman collection, which documents the linked-Page
  requirement for Instagram professional accounts:
  <https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api>

## 3. Existing implementation on `main`

Do not rebuild these paths from scratch. Read them before editing.

| Responsibility          | Existing path                                                                                            | Current state                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Customer route          | `src/app/(customer)/connect-meta/page.tsx`                                                               | Exists; redirects connected workspaces to settings.                                   |
| Customer guide          | `src/components/meta/connect-meta-guide.tsx`                                                             | Text-only checklist, polling, confirmation. No real screenshots.                      |
| Poll assigned account   | `src/app/api/integrations/meta/partner-accounts/route.ts`                                                | Workspace-scoped; returns only an operator-verified assignment.                       |
| Claim assigned account  | `src/app/api/integrations/meta/partner-claim/route.ts`                                                   | Verifies readable ad account and Page, writes provider connection and token.          |
| Partner Graph helpers   | `src/lib/providers/meta-partner.ts`                                                                      | Reads Business ID/system token from environment; basic reachability checks.           |
| Operator assignment API | `src/app/api/operator/customers/[workspaceId]/meta-partner-assignment/route.ts`                          | Operator-only GET/PUT/DELETE with account/Page verification.                          |
| Operator assignment UI  | `src/app/(operator)/operator/customers/[workspaceId]/meta-partner-assignment.tsx`                        | Manual ad-account-ID and Page-ID entry.                                               |
| Assignment table        | `supabase/migrations/20260803160000_prelaunch_tenant_and_queue_hardening.sql`                            | One workspace per ad account; service-role only.                                      |
| Publishing setup        | `src/app/api/integrations/meta/setup/route.ts` and `src/app/(customer)/settings/connections-section.tsx` | Filters partner assets to the assignment; supports Page and optional Instagram actor. |
| Normal OAuth            | `src/app/api/integrations/meta/connect/route.ts` and `callback/route.ts`                                 | Must remain intact for the approved future path.                                      |
| Provider token vault    | `src/lib/providers/provider-connections.ts` and private-vault migrations                                 | Existing encrypted per-connection token storage.                                      |
| Partner unit tests      | `tests/meta-partner.test.ts`                                                                             | Covers config parsing and two Graph helpers only.                                     |
| UX reference            | `mockups/meta-connection-request-20260831/index.html`                                                    | Ignored mockup, useful for interaction intent only.                                   |

## 4. Confirmed gaps to close

These are not optional polish items.

1. `verifyPartnerAccountAccess` proves only that `id,name` can be read. It does
   not prove campaign-management capability despite comments claiming that it
   covers view-only shares.
2. The customer checklist mentions only the ad account. The claim path also
   requires Facebook Page access. A linked Instagram professional identity may
   be discoverable through that Page, so the customer must not be asked to
   share Instagram separately unless Step 0 proves that the exact Blockwise
   publishing path requires a separate Meta asset assignment.
3. The customer copy says Meta was opened automatically, but the implementation
   requires a click. Browsers can block unsolicited new tabs.
4. The settings `Reconnect` link points to `/connect-meta`, while that route
   redirects any connected workspace back to settings. Reconnect is therefore
   a loop.
5. The current generic Meta disconnect route can attempt `/me/permissions`.
   A partner connection uses a shared Blockwise system-user token, so revoking
   that grant can affect every partner-connected customer. Partner disconnect
   must never revoke the shared Meta app/system-user grant.
6. `META_SYSTEM_USER_TOKEN` is read from process environment even though
   Blockwise's repository law requires provider tokens to live in the private
   token vault and be accessed through service-role RPCs.
7. There is no durable customer-request state between `I saved this in Meta`
   and operator assignment. Polling alone gives the operator no reliable queue.
8. Operator assignment requires typing IDs and provides no safe selector of
   currently visible, unassigned assets.
9. The UI has no production real screenshots and no capture, reuse-rights,
   redaction, provenance, or freshness policy.
10. The partner routes and cross-workspace assignment boundaries lack route and
    end-to-end coverage.
11. A successful claim can imply publishing readiness before privacy-policy and
    final asset setup are complete.
12. Non-owner/non-admin users can reach a guide that never polls and does not
    clearly explain who must complete the task.

## 5. Product and UX contract

### Job and audience

- Audience: workspace owner/admin, usually a real-estate agent or office
  administrator, already signed into Meta and likely unfamiliar with Business
  Portfolio permissions.
- State of mind: motivated to publish, wary of handing over control, easily
  confused by Meta's terminology.
- Mode: Operate. One obvious action at a time; no dashboard of choices.

### Outcome and proof

- `Connected` means the Blockwise server has verified the assigned ad account,
  Facebook Page, token validity, and workspace ownership binding.
- `Ready to publish` additionally means the Meta setup validator has no
  blockers, including a valid selected Page and required privacy-policy URL.
- Instagram is optional. If absent, the customer must be told that ads will use
  the Facebook Page identity.
- The UI must display exact assigned asset names before the customer confirms.

### Interaction sequence

1. **Get ready** — explain owner/admin requirement, required assets, five-minute
   estimate, and revocability.
2. **Open Partners** — show and copy Blockwise Business ID; customer explicitly
   clicks `Open Meta Business Settings`.
3. **Follow four real screens** — Partners, Give partner access, Business ID,
   asset/permission assignment.
4. **Customer completion signal** — customer clicks `I've assigned the assets`.
   Create/update a durable request and enter the waiting state.
5. **Operator verification** — operator selects an unassigned ad account and
   Page, verifies them through Graph, and saves the one-workspace binding.
6. **Customer confirmation** — customer sees only the assignment for their
   workspace and selects `Yes, these are mine`.
7. **Finish setup** — choose optional Instagram identity, confirm privacy-policy
   URL and any remaining setup values, then save.
8. **Success** — show `Meta connected` and either `Ready to publish` or a precise
   list of remaining blockers.

### Visual authority

- Use the Blockwise shadcn/Tailwind customer surface and tokens from
  `src/app/tailwind.css` and `DESIGN.md`.
- Use the Impeccable sequence:
  `critique → distill → craft → layout → typeset → adapt → harden → polish`.
- Reuse `Button`, `Card`/panel patterns, `StatusPill`, form primitives, focus
  behavior, and `src/lib/motion.ts`.
- Do not add route-global CSS, a second component system, gradients, decorative
  animation, or a new accent color.

### Screenshot policy

- The Sellforte screenshots in the ignored mockup are reference material only.
  Do not ship third-party screenshots in production without written reuse
  permission.
- Capture Blockwise-operated screenshots from a Blockwise-owned Meta test
  Business Portfolio using the same UI version proven in Step 0, subject to the
  written Meta reuse/brand decision in Step 5.
- Use generic test names. Redact account IDs, people, notifications, business
  names, and profile images before committing.
- Never fabricate switches or labels. Cropping and redaction are allowed;
  changing Meta controls is not.
- Store optimized captures under:
  `public/help/meta/partner-access/01-partners.webp` through
  `04-assets-and-permissions.webp`.
- Store only sanitized derivatives under `public/`; keep the detailed hashes,
  source screen, reuse decision, reviewers, and redaction/freshness record in
  `docs/evidence/meta-partner-screenshots/manifest.json` as defined in Step 5.
- Every screenshot is clickable to full size and has meaningful alt text.

### Accessibility and responsive contract

- Keyboard operation for every step, copy action, screenshot link, refresh,
  confirmation, and form field.
- Focus moves to the new step heading after a step transition and returns
  correctly from any dialog/sheet.
- Status changes use `role="status"`; blocking errors use `role="alert"`.
- Minimum touch target: 44 by 44 CSS pixels.
- Reflow without horizontal page scrolling at 320, 390, 768, and 1440 pixels.
- Screenshots fit the viewport and open full size rather than forcing a wide
  inline scroll region.
- Reduced motion removes transforms and nonessential progress animation.

## 6. Architecture and data flow

```text
Customer /connect-meta
  │
  ├─ GET partner status (workspace guard, owner/admin check)
  │    ├─ Business ID (non-secret configuration)
  │    ├─ request state
  │    ├─ workspace-only operator assignment
  │    └─ current provider connection/setup state
  │
  ├─ POST "assets shared" + expected ad-account/Page IDs
  │    └─ CAS RPC -> request(waiting_for_assignment) + fail-closed audit
  │
  └─ poll only while waiting
       └─ assignment becomes ready
              │
Operator customer queue/detail
  │           │
  ├─ enumerate system-token-visible assets internally (operator API only)
  ├─ serialize only exact expected-ID matches
  ├─ exclude assets already assigned to another workspace
  ├─ verify ad account + Page + optional Instagram relationship
  └─ atomic assignment + ready-state + fail-closed audit RPC
              │
Customer confirms workspace-only assignment
  │
  ├─ server re-verifies current access/capabilities
  ├─ compares the live assets with the customer-supplied expected IDs
  ├─ atomically writes provider connection + request + fail-closed audit
  ├─ saves partner metadata and setup defaults (no copied shared token)
  ├─ resolves the one runtime-vault system token only when used
  └─ queues best-effort reporting refresh
              │
Existing Meta setup / publish / reporting / leads pipelines
```

### Security invariants

1. Every customer query filters by authenticated `workspace_id`.
2. A customer route never lists the shared global pool of ad accounts, Pages,
   businesses, or Instagram actors.
3. Only an operator can bind a visible Meta asset to a workspace.
4. An ad account, Page, or Instagram identity cannot be assigned to two
   workspaces in v1. A future shared-agency exception requires a separate plan.
5. Before global candidates are queried, the customer supplies the exact ad
   account ID and Page ID shown in Meta. The operator API returns only exact-ID
   matches; a wrong ID produces `needs_help`, never a nearest-name suggestion.
6. The customer confirms only the assignment already bound to their workspace.
7. Customer-supplied IDs are correlation inputs, not authority. Names,
   currencies, timezones, business ownership, Page/Instagram relationships,
   and every capability are loaded from Graph and saved canonically.
8. The system token is never returned to a browser, logged, placed in query
   strings, stored in public tables, or committed in `.env.example`.
9. Partner connections reference the single encrypted runtime-vault token;
   the shared token is never copied into per-connection vault rows.
10. Partner disconnect changes only the target workspace's rows.
    It never calls Meta's global permission-revocation endpoint.
11. OAuth connections keep their existing revocation behavior. Missing or
    unknown connection-method metadata fails closed and never revokes Meta.
12. A connection cannot be marked `connected` unless live Graph verification
    succeeds at claim time.
13. Publishing remains PAUSED-first and continues to use the existing approval,
    idempotency, ownership, budget, and workspace guards.

## 7. Dependency graph and parallel work

```text
Prerequisite A  Reconcile VPS acceptance authority in AGENTS.md
  └─ Step 0  External-account proof gate
       └─ Step 1  Shared-token containment and rollout safety
            └─ Step 2  Durable request schema and contracts
                 ├─ Step 3  Meta capability adapter and route hardening
                 │    └─ Step 5  Customer guided flow
                 └─ Step 4  Operator verification workflow
                      └─ Step 5  Customer guided flow
                           └─ Step 6  Setup, Instagram, reconnect, disconnect
                                └─ Step 7  Full security/UX/E2E verification
                                     └─ Step 8  Canary release and runbook
                                          └─ Step 9  OAuth cutover/sunset
```

Steps 3 and 4 may run in parallel only after Step 2's request/assignment API
types are merged. They own different files. All other steps are serial.

## 8. Step-by-step construction plan

### Step 0 — Prove the platform path with a genuinely external business

- **Model tier:** strongest available
- **PR:** `docs/meta-partner-proof`
- **Depends on:** Prerequisite A merged
  **Production mutation:** no Blockwise production mutation; a disposable external
  Meta campaign/form/creative/ad and test lead are created, verified, and removed

#### Cold-start context

The code assumes a Blockwise system-user token can act on assets that an
unrelated customer shares to the Blockwise Business Portfolio. Current Meta
materials warn that managing other businesses' ad accounts may still require
the Marketing API access tier. A developer-role or Blockwise-owned ad account
does not prove the workaround.

#### Tasks

1. Name two people in the proof PR: `proof_executor` and an independent
   `proof_reviewer`. The reviewer must not be the person who ran the test.
2. Create or select a test Business Portfolio that:
   - is not owned by Blockwise;
   - has no user added as a Meta app developer/tester/admin;
   - owns one disposable ad account, one Facebook Page, and optionally one
     linked Instagram professional account;
   - has no live spend attached to the test campaign used below.
3. In Blockwise's Business Portfolio:
   - confirm Business Verification state;
   - confirm the app is installed for the Blockwise system user;
   - record the app mode and Marketing API Access Tier (`Full Access` or
     `Limited Access`), without assuming the tier is sufficient;
   - confirm the exact product permission set: `ads_read`, `ads_management`,
     `business_management`, `leads_retrieval`, `pages_manage_ads`,
     `pages_show_list`, and `pages_read_engagement`;
   - record the token only in the approved private runtime-token vault or a
     one-session local secret manager. Never write it to the repo.
4. From the external Business Portfolio, add Blockwise as a partner and share:
   - the disposable ad account with `Manage campaigns (ads)` and
     `View performance` partial access;
   - the Facebook Page with the minimum Page task needed for ad identity and
     Page token resolution;
   - do **not** share the linked Instagram account separately on the first pass.
     First prove whether the Page-linked professional identity is discoverable
     and usable through the shared Page. Repeat with a separate Instagram asset
     assignment only if the first pass fails for an Instagram-specific access
     reason, and record that evidence in the proof runbook.
5. Add `scripts/meta/verify-partner-external.mjs`. It must import the repository
   Meta adapters rather than reimplementing Graph calls, accept the token from
   stdin/approved vault only, refuse Blockwise-owned/app-role fixtures, create
   only `PAUSED` objects, and always run bounded cleanup in `finally`.
6. Through that script and the actual repository adapters, run read probes
   against the configured Graph version:
   - system-token identity/debug information;
   - ad-account `id,name,currency,timezone_name,account_status,business`;
   - Page access-token resolution;
   - Page-linked `instagram_business_account` discovery without a separate
     Instagram asset assignment;
   - campaign listing and reporting Insights for the external ad account.
7. Execute one complete disposable product path, not a campaign-only probe:
   - build the same `OUTCOME_LEADS` + `HOUSING` publish plan used by Ad Studio;
   - create the campaign, ad set, Instant Form, creative, and ad through the
     repository executor, with every deliverable object exactly `PAUSED`;
   - use the shared Page as the ad identity and, if discovered, the Page-linked
     Instagram professional identity;
   - read every object back and verify account/Page/identity ownership and
     `PAUSED` status;
   - submit one synthetic test lead using Meta's approved Lead Ads testing path,
     retrieve it through the repository lead adapter, then delete the local
     test-lead data;
   - read reporting for the created objects;
   - delete/archive every disposable Meta object through the proven safe order;
   - record cleanup receipts and fail the proof if any object remains.
8. Add `docs/runbooks/meta-partner-external-proof.md` containing:
   - the exact prerequisites;
   - redacted successful request/response contracts;
   - the precise permission/task combination that worked;
   - the failure interpretation table;
   - the date after which the proof must be rerun: 90 days, a Graph version
     change, an app-mode/access-tier change, or a permission change, whichever
     occurs first.
9. Commit a sanitized receipt at
   `docs/evidence/meta-partner-proof/<YYYY-MM-DD>/receipt.json` containing the
   commit SHA, Graph version, app ID, app mode, access tier, permission list,
   external-business attestation, UTC start/end times, hashed Meta object IDs,
   each read/write/delete outcome, cleanup completion, fixture SHA-256 hashes,
   `expires_at`, `proof_executor`, and `proof_reviewer`. Never store names,
   tokens, lead data, or raw customer IDs. The reviewer verifies the receipt
   against the live run and approves the PR explicitly.
10. Add sanitized JSON fixtures beside the receipt for the exact responses that
    later capability tests consume. Add a test that rejects an expired receipt
    whenever partner starts are enabled.

#### Go criteria

The full PAUSED product path, Page identity, reporting read, synthetic lead
retrieval, and cleanup all succeed using the Blockwise system-user token against
the non-app-role external business; the independent reviewer signs the receipt.

#### Stop criteria

Stop if Meta returns an access-tier/App Review error, any product permission or
capability is missing, the Page cannot be used as ad identity, test leads cannot
be retrieved, cleanup is incomplete, the receipt is not independently reviewed,
or the only working path adds the customer as an app role. Document the failure
and do not implement customer claims.

#### Verification

```powershell
npm test -- --test-name-pattern="meta partner proof"
npm run typecheck
```

#### Exit criteria

- Sanitized proof receipt and exact fixtures are committed and reviewed.
- Runbook names the exact access tier, permissions, tasks, and Graph version.
- Every disposable Meta object has a successful cleanup receipt.
- A human can distinguish `permission missing`, `asset not shared`,
  `access tier missing`, and `invalid token` from the recorded error table.

#### Rollback

Proof-script/runbook/fixture PR. Revert its repository changes if the proof is
invalidated, turn partner starts off, and retain the sanitized failure receipt.
Do not leave any disposable Meta object or local test-lead data behind.

---

### Step 1 — Contain the shared token and make rollout controls explicit

- **Model tier:** strongest available
- **PR:** `fix/meta-partner-token-containment`
  **Depends on:** Step 0 passed

#### Cold-start context

The partner flow uses one Blockwise system-user token across customer assets.
The current generic disconnect path can revoke Meta permissions, which would
have a global blast radius. The token is also read from an environment variable
despite the repository's private-vault rule.

#### PR split and owned files

Implement this step as two serial PRs. PR 1A is the schema-independent safe
disconnect patch; merge it before any partner exposure. PR 1B is the runtime
token/configuration refactor.

- `src/app/api/integrations/meta/disconnect/route.ts`
- `src/lib/providers/meta-partner.ts`
- `src/lib/providers/provider-connections.ts`
- new `src/lib/providers/meta-graph-client.ts`
- every Meta token consumer returned by
  `rg -n "loadStoredProviderTokens|access_token" src worker -g "*.ts"`
- specifically `meta-reporting.ts`, `meta-leads.ts`, `meta-assets.ts`,
  `meta-campaigns.ts`, the Meta workers, monitor loader, setup/publish routes,
  disconnect route, and `worker/index.ts`
- operator assignment route for deletion protection
- new Supabase migration for runtime provider key `meta_partner`
- token provisioning/rotation script under `scripts/` using existing vault RPCs
- `.env.example`
- `infra/product/.env.example`
- `infra/coolify/docker-compose.product.yml`
- `infra/product/product-migrations.txt`
- `src/lib/config/env.ts` or the existing server-only feature/config module
- focused tests for disconnect and vault behavior

#### Tasks

1. Replace the ambiguous global mode with four independent server-only
   controls; reject malformed values at startup:
   - `BLOCKWISE_META_NEW_CONNECTION_METHOD=oauth|partner`, default `oauth`;
   - `BLOCKWISE_META_PARTNER_STARTS_ENABLED=false|true`, default `false`;
   - `BLOCKWISE_META_PARTNER_ALLOWED_WORKSPACE_IDS=<comma-separated UUIDs>`,
     default empty and capped at five IDs during the early-access phase;
   - `BLOCKWISE_META_PARTNER_WRITE_ALLOWED_WORKSPACE_IDS=<comma-separated
UUIDs>`, default empty.
     Resolve a workspace's new-connection method exactly as follows: if starts are
     enabled and its UUID is in the partner allowlist, use `partner`; otherwise
     use `BLOCKWISE_META_NEW_CONNECTION_METHOD` (normally `oauth`). An empty
     allowlist can never expose partner flow globally, even if the default is set
     incorrectly; startup rejects `default=partner` during early access.
     Existing rows with `connectionMethod="partner_access"` remain readable and
     disconnectable regardless of the new-connection default or starts switch.
     The emergency switch blocks start, retry, assignment, and claim; it never
     blocks status reads or safe disconnect. Partner writes require both the
     existing global write gate and membership in the write allowlist.
2. Add the non-secret Business ID and all four safe defaults to root and product
   `.env.example`; pass them through product Compose.
   - Business ID is not a secret.
   - Do not add `META_SYSTEM_USER_TOKEN` to `.env.example`.
3. Extend the private runtime-token vault's allowed providers with
   `meta_partner` through a tested migration. Keep the `private` schema hidden
   and RPCs service-role-only.
4. Extend `RuntimeProvider` to include `meta_partner`.
5. Replace synchronous `getMetaPartnerConfig()` with a server-only loader that:
   - reads Business ID from validated server config;
   - loads the system token through `runtime_provider_token_vault_get`;
   - returns a typed `unconfigured` result without revealing which secret is
     missing to customer callers;
   - never logs the token or includes it in thrown messages.
6. Add `resolveProviderConnectionAccessToken(serviceClient, connection)`:
   - for `partner_access`, verify the workspace assignment still matches the
     connection metadata, then load the single `meta_partner` runtime token;
   - for explicit `oauth`, load the connection's private vault row;
   - for missing/unknown method, return a typed `unknown_connection_method`
     failure; never guess and never call a global revoke endpoint.
     Migrate every Meta consumer to this resolver. Do not copy the runtime token
     into `private.provider_token_vault` for partner rows.
7. Add one shared Graph request helper that uses `Authorization: Bearer` for the
   system/user token. Remove token query parameters from all Meta calls. Accept
   paging URLs only when protocol is HTTPS and hostname is exactly
   `graph.facebook.com`; reject credentials embedded in URLs, impose timeouts
   and page/result caps, and redact headers, bodies, URLs, and Meta diagnostics.
8. Add an operator-only CLI script that reads a token from stdin and calls the
   existing encrypted runtime-vault upsert helper. The token must never appear
   in command history, process arguments, output, or a file.
9. In PR 1A, make disconnect select exactly one explicit active Meta connection
   by its connection ID plus authenticated workspace. Define behavior:
   - `partner_access`: mark only that row `not_connected`; no per-connection
     token exists to clear; retain assignment; emit the named audit action
     `meta.partner.disconnected`; never call `/me/permissions`;
   - explicit `oauth`: preserve current remote revocation, then mark only that
     row disconnected and clear only its private vault row;
   - missing/unknown method: perform local disconnect only, return a warning
     code, and make zero Meta revocation calls;
   - repeated disconnect is idempotent; a vault/DB/audit failure returns failure
     and does not claim completion.
     Never select “latest” without active-status and connection-ID filters; never
     update every Meta row in a workspace.
10. Refuse operator assignment deletion while an active partner provider
    connection references it. The UI must instruct the operator to disconnect
    the workspace first.
11. Add a unit test with two partner-connected workspaces proving that
    disconnecting workspace A does not mutate workspace B and makes zero Meta
    revocation calls. Add legacy/unknown metadata, repeated disconnect, partial
    failure, malicious paging URL, query-string token, and token-redaction tests.
12. Provision and verify the runtime-vault token before removing
    `META_SYSTEM_USER_TOKEN` from product Compose. Rotation is one-row: upsert the
    new encrypted runtime token, verify expected app/system-user identity, run a
    read canary, then invalidate the old token. On verification failure, restore
    the old vault value and do not invalidate it.

#### Verification

```powershell
npm test -- --test-name-pattern="partner disconnect|runtime provider token|meta rollout controls"
npm run typecheck
npm run test:db
```

#### Exit criteria

- No application code or product Compose service reads
  `META_SYSTEM_USER_TOKEN`.
- No partner disconnect calls `/me/permissions`.
- No Meta URL, log, exception, fixture, or snapshot contains a bearer token.
- Partner provider-vault rows do not contain copies of the system token.
- Token RPC grants remain service-role-only.
- Invalid/absent rollout configuration is deterministic and fail-closed.
- Two-workspace isolation test passes.

#### Rollback

Set `BLOCKWISE_META_PARTNER_STARTS_ENABLED=false` and
`BLOCKWISE_META_NEW_CONNECTION_METHOD=oauth`. Keep existing partner runtime
resolution and safe disconnect operational. Never roll back to query-string
tokens or ambiguous/global disconnect. Leave additive vault/schema support in
place after production and fix forward.

---

### Step 2 — Add a durable connection-request state machine

- **Model tier:** strongest available
- **PR:** `feat/meta-partner-request-state`
  **Depends on:** Step 1

#### Cold-start context

The existing UI polls for an assignment but never records that a customer has
finished Meta's screens. The operator therefore has no reliable queue and a
page reload loses the customer's progress. Add the smallest durable state that
solves that orchestration problem.

#### Owned files

- new timestamped migration in `supabase/migrations/`
- `infra/product/product-migrations.txt`
- `src/lib/providers/meta-partner.ts` or new
  `src/lib/providers/meta-partner-requests.ts`
- new route `src/app/api/integrations/meta/partner-request/route.ts`
- existing partner status route
- `src/lib/operator/customers.ts`
- DB and route tests

#### Schema

Create `public.meta_partner_connection_requests`:

| Column                   | Type / rule                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `workspace_id`           | UUID primary key, FK `workspaces(id) on delete cascade`                                                               |
| `generation`             | bigint not null default 1, check > 0; increment only for explicit reconnect/restart                                   |
| `version`                | bigint not null default 1, check > 0; increment on every mutation for CAS                                             |
| `status`                 | text check: `started`, `waiting_for_assignment`, `ready_to_claim`, `claiming`, `connected`, `needs_help`, `cancelled` |
| `requested_by`           | UUID nullable FK to `profiles`, set null on delete                                                                    |
| `expected_ad_account_id` | text nullable, normalized `act_<digits>`; required before `assets_shared`                                             |
| `expected_page_id`       | text nullable, digits only; required before `assets_shared`                                                           |
| `expected_business_id`   | text nullable, digits only; correlation evidence when Meta exposes it                                                 |
| `requested_at`           | timestamptz not null default now()                                                                                    |
| `last_checked_at`        | timestamptz nullable                                                                                                  |
| `completed_at`           | timestamptz nullable                                                                                                  |
| `claim_lease_id`         | UUID nullable; set only in `claiming`                                                                                 |
| `claim_lease_expires_at` | timestamptz nullable; maximum five minutes                                                                            |
| `retry_after`            | timestamptz nullable                                                                                                  |
| `last_error_code`        | text nullable; stable internal code, never token text                                                                 |
| `last_error_message`     | text nullable; sanitized customer-safe message                                                                        |
| `updated_at`             | timestamptz not null default now()                                                                                    |

Security:

- enable RLS;
- revoke table access from `public`, `anon`, and `authenticated`;
- grant only `service_role`;
- all browser access goes through guarded server routes;
- add an index on `(status, updated_at)` for the operator queue;
- `updated_at` and `version` change inside the RPC, never by a client trigger;
- `completed_at` is non-null only for `connected` or `cancelled`; claim lease
  fields are non-null only for `claiming`; `retry_after` is cleared on success.

Extend `meta_partner_account_assignments` additively with:

- `id uuid not null default gen_random_uuid()` plus a unique constraint;
- `version bigint not null default 1`;
- canonical `business_id`, `business_name`, optional
  `instagram_actor_id`, `instagram_username`;
- `verified_at`, `verification_receipt_hash`, and `request_generation`;
- unique constraints on normalized `ad_account_id`, `page_id`, and non-null
  `instagram_actor_id` for v1.

Existing assignment rows receive IDs/version but remain unverified; partner
starts stay disabled until an operator re-verifies and fills the new provenance.
Before adding a partial unique index allowing at most one live Meta connection
(`status in ('connected','needs_attention')`) per workspace, run a migration
preflight that raises with the duplicate workspace IDs. Do not silently demote
or delete existing rows.

#### State transitions

```text
none -> started
started -> waiting_for_assignment
waiting_for_assignment -> ready_to_claim | needs_help | cancelled
needs_help -> waiting_for_assignment | ready_to_claim | cancelled
ready_to_claim -> claiming | waiting_for_assignment | needs_help | cancelled
claiming -> connected | ready_to_claim | needs_help | cancelled
connected -> cancelled (disconnect only)
connected -> started (explicit reconnect RPC; generation + 1, same assignment
                      only, and existing provider row atomically not_connected)
cancelled -> started (explicit restart; generation + 1)
```

Reject every transition not listed above. Repeating the same action with the
same idempotency key returns the prior result. Every mutation supplies expected
`generation` and `version`; stale callers receive HTTP 409 and current state.
`claiming` uses a five-minute UUID lease. An expired lease may be atomically
recovered to `ready_to_claim`; a non-expired lease cannot be stolen. A
retryable Graph failure returns to `ready_to_claim` with `retry_after`; a
non-retryable asset/permission failure enters `needs_help`.

Create service-role-only SQL RPCs for transitions. Each RPC performs the state
CAS and inserts its required `audit_logs` row in the same transaction; do not
use best-effort `recordAuditLog()` for these security-sensitive events. Name
actions exactly: `meta.partner.started`, `assets_shared`, `retry_requested`,
`assignment_ready`, `assignment_rejected`, `claim_started`, `claim_failed`,
`connected`, `cancelled`, and `disconnected`. Audit metadata contains only
workspace/request generation, assignment ID/version, stable code, actor ID,
and correlation ID—never tokens or unverified customer labels.

#### API contracts

`POST /api/integrations/meta/partner-request`

Request:

```json
{
  "action": "start|assets_shared|retry|not_mine|cancel|reconnect",
  "generation": 1,
  "version": 3,
  "idempotencyKey": "uuid",
  "expectedAdAccountId": "act_123456789",
  "expectedPageId": "123456789",
  "expectedBusinessId": "123456789"
}
```

Response:

```json
{
  "request": {
    "status": "waiting_for_assignment",
    "generation": 1,
    "version": 4,
    "requestedAt": "ISO-8601",
    "updatedAt": "ISO-8601"
  }
}
```

Rules:

- use `requireApiWorkspace(..., "monitor")`;
- require `canManageProviderConnections`;
- derive workspace/user from the guard, not the body; do not accept
  `workspaceId` in the request schema;
- `start` creates generation 1; `reconnect` is explicit and increments it;
- `assets_shared` validates both expected asset IDs before entering waiting;
- `not_mine` atomically removes the assignment and enters `needs_help`;
- each idempotency key is scoped by workspace + generation + action and stored
  or audited so a replay returns the same response;
- apply the rollout starts switch and workspace allowlist to start/reconnect,
  but never to status or disconnect.

The status GET response must contain only:

- configured boolean;
- non-secret Business ID;
- request status/timestamps/customer-safe error;
- request generation/version and retry time;
- assignment for the current workspace only;
- current provider connection/setup state.

It must never contain unassigned/global candidates.

#### Operator queue integration

1. Load request rows in `loadCustomerRelations`.
2. Add `meta_partner_waiting` as a separate explicit queue key with label
   `Meta waiting for verification`; do not mix normal assisted work into
   `meta_help_needed`.
3. Include request `updated_at` in `lastActivityAt`.
4. Add the request record to `OperatorCustomerDetail`.
5. Preserve every existing queue calculation and its tests.

#### Verification

```powershell
npm run test:db
npm test -- --test-name-pattern="meta partner request|operator customer queue"
npm run typecheck
```

#### Exit criteria

- Reloading `/connect-meta` reconstructs the correct durable phase from server
  state; it need not remember which instructional screenshot was last viewed.
- A customer cannot transition another workspace.
- A member without owner/admin rights receives 403.
- Operator queue shows waiting requests.
- No global Meta asset data is exposed.

#### Rollback

Turn partner starts off and default new connections to OAuth. Keep the additive
table in production; do not drop it if non-empty. A later cleanup can archive it
under `legacy_archive`.

---

### Step 3 — Harden Meta capability verification and claim semantics

- **Model tier:** strongest available
- **PR:** `fix/meta-partner-capability-verification`
- **Depends on:** Step 2
  **May run parallel with:** Step 4

#### Cold-start context

The existing claim trusts a basic `id,name` read as proof of campaign-management
access. Step 0 produced the exact successful Graph response contract for the
current Meta access tier and Graph version. Implement only that proven contract;
do not invent endpoints or permission labels.

#### Owned files

- `src/lib/providers/meta-partner.ts`
- `src/app/api/integrations/meta/partner-accounts/route.ts` or its renamed
  status route
- `src/app/api/integrations/meta/partner-claim/route.ts`
- `src/app/api/integrations/meta/setup/route.ts`
- focused fixtures/tests

#### Tasks

1. Replace `verifyPartnerAccountAccess(): boolean` with a typed capability
   result, for example:

```ts
type MetaPartnerCapabilities = {
  tokenValid: boolean;
  expectedAppAndSystemUser: boolean;
  adAccountReadable: boolean;
  campaignManagementVerified: boolean;
  pageAccessible: boolean;
  pageAdIdentityVerified: boolean;
  leadFormsReadable: boolean;
  reportingReadable: boolean;
  instagramActorId: string | null;
  accountStatus: "active" | "inactive" | "unknown";
  blockers: Array<{
    code: string;
    message: string;
    retryable: boolean;
    retryAfterSeconds: number | null;
  }>;
};
```

2. Implement the exact probes proven in Step 0. At minimum verify:
   - token is valid and belongs to the expected app/system user;
   - required token scopes are present;
   - assigned ad account is active and readable;
   - the proven asset task/capability for campaign management is present;
   - assigned Page can resolve a Page access token;
   - Page ad-identity, lead-form, reporting, and lead-retrieval capabilities
     match the accepted Step 0 receipt/fixtures;
   - optional Instagram actor belongs to/is linked with the assigned Page.
3. Normalize all ad account IDs once at the boundary to `act_<digits>`.
4. Map Graph errors into stable internal codes:
   - `meta_token_invalid`
   - `meta_access_tier_missing`
   - `meta_ad_account_not_shared`
   - `meta_manage_campaigns_missing`
   - `meta_page_not_shared`
   - `meta_instagram_not_linked`
   - `meta_rate_limited`
   - `meta_temporarily_unavailable`
   - `meta_proof_expired`
   - `meta_unknown_error`
5. Preserve raw Meta errors only in redacted server diagnostics. Customer
   messages name the corrective action and never include tokens/request URLs.
   Return stable HTTP mapping: validation 400, auth 401/403, stale CAS/conflict
   409, Meta rate limit 429 with bounded `Retry-After`, transient dependency
   503, and unknown sanitized failure 502. Every response carries a correlation
   ID that is safe to show support.
6. Claim accepts only `generation`, `version`, `assignmentId`,
   `assignmentVersion`, and `idempotencyKey`; it never accepts asset metadata.
   Expected IDs come from the request and canonical values from assignment/live
   Graph.
7. Implement claim as lease + external verification + atomic finalize:
   - call `meta_partner_begin_claim` RPC with expected request generation/version
     and assignment ID/version; it transitions `ready_to_claim -> claiming`,
     creates a five-minute lease, and writes `claim_started` audit atomically;
   - perform Graph verification outside a database transaction with bounded
     timeout/cancellation; confirm request expected IDs equal assignment IDs and
     live canonical IDs, and assignment business/Page/Instagram provenance;
   - call `meta_partner_finalize_claim` with the lease and expected versions;
     in one SQL transaction it enforces the active-connection unique index,
     upserts exactly one partner provider row, writes
     `connectionMethod: "partner_access"`, assignment ID/version and proof
     receipt hash, marks the request connected, clears lease/error fields, and
     inserts required audit events;
   - partner provider rows contain no access token; runtime consumers resolve
     the single runtime-vault token through Step 1;
   - if Graph fails, call `meta_partner_fail_claim` with the lease and stable
     code; retryable failures return to `ready_to_claim` with `retry_after`, and
     non-retryable failures enter `needs_help`, atomically with audit;
   - if cancel/reassign/disconnect changed a version while Graph was running,
     finalize returns 409 and writes no provider row;
   - only after atomic success, record non-security funnel telemetry and enqueue
     reporting refresh best-effort.
8. Add concurrency/fault-injection tests: two claim calls, reassignment during
   verification, cancel during verification, expired lease recovery, DB failure,
   audit insertion failure, and runtime-vault failure. None may leave a live
   connection without a connected request or return false success.
9. Ensure setup filtering continues to restrict partner connections to the
   assigned ad account, Page, Page-linked Instagram actor, lead forms, and
   applicable pixels.

#### Verification

```powershell
npm test -- --test-name-pattern="meta partner capability|meta partner claim|partner setup filtering"
npm run typecheck
```

#### Exit criteria

- View-only assignment cannot claim successfully.
- Wrong Page cannot claim successfully.
- Expired/invalid token cannot claim successfully.
- Cross-workspace ad account cannot claim successfully.
- Claim ignores spoofed browser metadata.
- Successful claim produces an atomically durable, downstream-loadable provider
  connection that references—without copying—the runtime-vault token.

#### Rollback

Turn partner starts off and default new connections to OAuth. Existing successful
provider connections remain usable. Do not roll back to the boolean readability
check.

---

### Step 4 — Build the operator verification workflow

- **Model tier:** default implementation model; strongest reviewer
- **PR:** `feat/meta-partner-operator-verification`
- **Depends on:** Step 2
  **May run parallel with:** Step 3

#### Cold-start context

Customers cannot safely see the global asset pool because it contains assets
from multiple businesses. Operators need a fast way to bind newly shared assets
without manually typing IDs, while retaining a deliberate human verification
step for tenant isolation.

#### Owned files

- `src/app/(operator)/operator/customers/[workspaceId]/meta-partner-assignment.tsx`
- `src/app/api/operator/customers/[workspaceId]/meta-partner-assignment/route.ts`
- `src/lib/operator/customers.ts`
- operator page/detail tests

#### Tasks

1. Keep the API operator-only with `requireOperator` and service-role reads.
2. Extend operator GET response with:
   - current request;
   - current assignment;
   - system-token configuration/health without token value;
   - only the unassigned active ad account whose ID exactly matches the
     request's `expected_ad_account_id`;
   - only the accessible Page whose ID exactly matches
     `expected_page_id`, plus its linked Instagram professional account;
   - candidate load errors as stable codes.
3. Never return the full global candidate list to this UI. Enumerate internally
   with bounded concurrency, ten-second request timeout, maximum 500 candidates,
   validated Graph paging hosts, and deterministic ID sort; filter exact IDs
   before serializing. Exclude any ad account, Page, or Instagram actor already
   assigned elsewhere and recheck all uniqueness constraints in the assignment
   RPC.
4. Do not auto-assign on name similarity. Names are hints only.
5. Use the operator shell's existing form controls; do not import shadcn/Tailwind
   into the legacy operator route. Present the exact matched assets as a
   confirmable radio/summary, not a global selector. A collapsed `Re-check exact
IDs` action may re-run the request's IDs; it must not accept an arbitrary ID
   that differs from the customer request. Mismatches go to `needs_help` for
   out-of-band customer correction.
6. Show the selected account's canonical name, ID, currency, timezone, business
   name, status, Page name/ID, and linked Instagram username before saving.
7. Require a final operator action `Verify and assign to <workspace name>`.
8. On PUT:
   - normalize IDs;
   - verify request is waiting/needs-help;
   - rerun Graph verification server-side;
   - require expected request generation/version and current assignment version;
   - prove live IDs exactly equal the request's expected IDs;
   - verify canonical owning/shared business provenance, Page access, and
     optional linked Instagram identity using the Step 0 contract;
   - reject an ad account, Page, or Instagram actor assigned elsewhere with 409;
   - call a service-role RPC that atomically upserts canonical assignment,
     transitions request to `ready_to_claim`, and inserts the fail-closed audit;
     no browser-submitted labels are persisted.
9. On DELETE:
   - block deletion if an active provider connection uses the assignment;
   - otherwise use an expected-version RPC to remove assignment, transition
     `ready_to_claim -> waiting_for_assignment`, and audit in one transaction.
10. Surface `Meta waiting for verification` in the operator queue and link
    directly to the assignment section on the customer detail page.
11. Complete Impeccable operator-surface pass using the existing operator CSS
    shell and controls. Do not introduce customer Tailwind components into that
    route.

#### Verification

```powershell
npm test -- --test-name-pattern="operator meta partner|operator customer queue"
npm run typecheck
```

Browser acceptance on the isolated controlled VPS staging hostname:

- desktop 1440×900;
- mobile-width 390×844 (mandatory; no horizontal scroll or hidden actions);
- select candidate, verify summary, assign, reload, remove-unconnected;
- confirm cross-workspace conflict is legible.

#### Exit criteria

- Operator can assign without copying IDs in the normal case.
- Customer/global asset data never crosses to customer routes.
- Every assignment has a matching audit record.
- Existing active connection cannot lose its assignment through this UI.

#### Rollback

Revert the UI presentation while retaining exact-ID correlation and canonical
verification APIs; do not restore arbitrary manual assignment. Keep request rows
unchanged. Turn partner starts off if operators cannot complete assignments.

---

### Step 5 — Replace the customer checklist with the guided real-screen flow

- **Model tier:** default implementation model; strongest visual reviewer
- **PR:** `feat/meta-partner-customer-guide`
  **Depends on:** Steps 3 and 4

#### Cold-start context

The current customer guide is a text checklist. The approved interaction intent
is in the ignored mockup, but production may use only reuse-approved,
Blockwise-operated real Meta captures (or the text-only fallback) and
Blockwise's existing customer component system.

#### Owned files

- `src/app/(customer)/connect-meta/page.tsx`
- `src/components/meta/connect-meta-guide.tsx`
- optional small components inside `src/components/meta/`
- `src/config/niche/...` for customer-facing copy where appropriate
- `public/help/meta/partner-access/*`
- component/static tests and Playwright coverage

#### Impeccable gates

1. `critique`: inspect current `/connect-meta`, `/settings#connections`, and the
   mockup; list cognitive-load and truthfulness defects before editing.
2. `distill`: reduce to one action per step and remove duplicate explanations.
3. `craft`: implement the state-driven flow using canonical primitives.
4. `layout`: one narrow task column, screenshot as evidence, action after copy.
5. `typeset`: retain Manrope/Inter/mono hierarchy from `DESIGN.md`.
6. `adapt`: verify 320, 390, 768, and 1440 widths.
7. `harden`: owner/admin restriction, loading, no-config, waiting, timeout,
   rate-limit, assignment, wrong-assets, claim failure, and reload states.
8. `polish`: one bounded desktop/mobile defect pass and one confirmation pass.

#### Customer state model

Do not manage the entire flow as an untyped collection of booleans. Define a
discriminated union derived from server state:

```ts
type MetaPartnerViewState =
  | { kind: "forbidden" }
  | { kind: "unconfigured" }
  | { kind: "ready_to_start"; businessId: string }
  | {
      kind: "following_guide";
      step: 1 | 2 | 3 | 4;
      businessId: string;
      generation: number;
      version: number;
    }
  | {
      kind: "waiting_for_assignment";
      requestedAt: string;
      generation: number;
      version: number;
    }
  | { kind: "needs_help"; code: string; message: string }
  | { kind: "ready_to_claim"; assignment: AssignmentSummary }
  | { kind: "claiming"; assignment: AssignmentSummary }
  | { kind: "connected_setup_required"; blockers: string[] }
  | { kind: "ready_to_publish"; assets: ConnectedAssets };
```

Local guide step can live in component state. Request/assignment/connection
state comes from the server and survives reload.

#### Exact screens and copy intent

1. **Before you start**
   - `Connect Meta in about five minutes`.
   - Need: owner/admin Meta access, ad account, Facebook Page, optional linked
     Instagram professional account.
   - Trust: Blockwise never sees the Meta password; partner access can be
     removed in Meta Business Settings.
   - Primary: `Show me what to do`.
2. **Open Partners**
   - show Business ID in selectable mono text;
   - Copy button with live `Copied` state;
   - explicit `Open Meta Business Settings` link;
   - never claim the tab opened before the customer clicks.
3. **Real screenshot guide, four steps**
   - Users → Partners;
   - Add → Give a partner access to your assets;
   - paste Partner Business ID;
   - select Facebook Page and ad account; for the ad account enable `Manage
campaigns (ads)` and `View performance`; leave full control off;
   - include a separate Instagram selection only if the Step 0 runbook records
     that it was necessary in the exact tested Meta UI; save/assign assets.
4. **Record the exact assets and wait**
   - show two required, separately labelled inputs: ad account ID and Facebook
     Page ID, with a real screenshot/caption showing where each ID appears;
   - normalize/validate IDs server-side; these values correlate the share but
     never replace live Graph verification;
   - primary action after the screenshot guide:
     `I've assigned the assets`;
   - the `assets_shared` RPC saves the expected IDs and durable waiting state
     atomically before polling starts;
   - text: `Blockwise is verifying the share. You can leave this page and come
back.`;
   - manual `Check again` action;
   - after five minutes, stop automatic polling and show `Still waiting for
verification` plus support guidance. Do not spin forever.
5. **Confirm assets**
   - show account and Page names/IDs; show Instagram if assigned/discovered;
   - primary `Yes, these are mine`;
   - secondary `These are not mine` transitions to needs-help and does not
     claim.
6. **Connection result**
   - `Meta connected` only after claim durability succeeds;
   - distinguish `Ready to publish` from `Finish publishing setup`;
   - link to the inline final setup step or settings as defined in Step 6.

#### Polling rules

- Poll only in `waiting_for_assignment`.
- Initial request immediately, then 6 seconds with capped exponential backoff
  after failures.
- Use `AbortController` and clear timers on unmount/state change.
- Pause while `document.visibilityState === "hidden"`; refresh immediately when
  visible again.
- Stop after five minutes and require manual resume.
- A 401/403 stops permanently and shows the correct auth/role state.
- A 429 respects `Retry-After`.
- Announce only meaningful state changes to assistive technology, not every poll.

#### Screenshot component rules

- Use `next/image` with intrinsic dimensions to prevent layout shift.
- Use `<a target="_blank" rel="noopener noreferrer">` around each image.
- Do not place badges over Meta's Save/Assign controls.
- Caption: `Real Meta Business Settings screen. Meta may change labels.`
- Keep Blockwise-specific permission instructions outside the image so the
  source pixels remain truthful.

#### Screenshot rights, privacy, and freshness gate

1. Before capture, the product owner records a written reuse/brand decision
   after checking current Meta Platform/brand terms. A Blockwise capture is not
   automatically Blockwise-owned underlying UI. If reuse is not permitted,
   ship concise text/deep-link instructions and support fallback—never a fake
   redraw presented as Meta.
2. Capture only in the disposable Blockwise test portfolio used by the current
   accepted Step 0 proof. Use generic names and no real customer/person data.
3. Keep raw originals outside git in approved access-controlled evidence
   storage. Commit only the cropped/redacted derivatives under
   `public/help/meta/partner-access/`.
4. Strip EXIF/ancillary metadata, then run OCR plus a manual second-person review
   for names, emails, notifications, account IDs, browser chrome, and tokens.
5. Commit `docs/evidence/meta-partner-screenshots/manifest.json` with capture
   date, capture operator, approved Step 0 receipt hash, source and derivative
   SHA-256 hashes, crop/redaction description, metadata-strip command/result,
   OCR/manual-review result, reuse decision reference, reviewer, and
   `review_after` date. Do not put provenance/PII details under `public/`.
6. Recapture when the Step 0 proof expires, the observed Meta labels/navigation
   differ, or 90 days passes. The guide always offers `Meta looks different`
   support guidance and never blocks safe cancellation.

#### Verification

```powershell
npm test -- --test-name-pattern="connect meta guide"
npm run typecheck
npm run test
```

Isolated controlled VPS staging browser matrix:

| Viewport | Required checks                                                   |
| -------- | ----------------------------------------------------------------- |
| 1440×900 | hierarchy, screenshot readability, focus, no dead space           |
| 768×1024 | step header/action wrapping, image sizing                         |
| 390×844  | no horizontal page scroll, 44px controls, readable permission box |
| 320×720  | reflow, no clipped IDs/buttons, screenshot full-size link         |

#### Exit criteria

- Customer can complete the guide without reading a long paragraph.
- Page sharing is explicit; Instagram sharing is omitted unless Step 0 proved it
  necessary, and the optional Page-linked identity is explained during setup.
- Permitted, Blockwise-captured Meta screenshots ship with sanitized manifest,
  redaction review, and freshness date—or the approved text-only fallback ships.
- Reloading restores waiting/ready/connected state.
- No false auto-open or instant-access claims remain.
- Serious/critical accessibility findings are zero.

#### Rollback

Set partner starts off and new connection method to OAuth, or revert the customer
UI PR. Durable request and assignment rows remain harmless. Do not revert
security fixes from Steps 1–3.

---

### Step 6 — Finish setup, Instagram handling, reconnect, and disconnect

- **Model tier:** strongest available
- **PR:** `feat/meta-partner-setup-completion`
  **Depends on:** Step 5

#### Cold-start context

Claiming proves asset access but does not automatically satisfy every publishing
requirement. The existing settings form supports Page, Instagram actor, pixel,
lead destination, privacy URL, currency, and timezone. Make the end of the
connection flow honest and remove reconnect/disconnect dead ends.

#### Owned files

- `src/app/(customer)/connect-meta/page.tsx`
- `src/components/meta/*`
- `src/app/(customer)/settings/connections-section.tsx`
- `src/app/api/integrations/meta/setup/route.ts`
- `src/app/api/integrations/meta/disconnect/route.ts`
- related tests

#### Tasks

1. Decide setup placement with this fixed rule:
   - if all required values can be derived and validation has no blockers, show
     `Ready to publish` on `/connect-meta`;
   - otherwise render the minimal unresolved setup fields inline on
     `/connect-meta` and keep `/settings#connections` as the later management
     surface.
2. Reuse one shared typed setup form/component. Do not copy the existing large
   form into a second independent implementation.
3. Ad account:
   - fixed to the operator assignment for partner connections;
   - display-only in customer setup;
   - changing it requires a new operator assignment/reconnect.
4. Facebook Page:
   - fixed to or constrained by the assignment;
   - validate live access on save.
5. Instagram:
   - show only professional actors linked to the assigned Page;
   - label optional;
   - if none, explain `Continue without Instagram — your ads will use the
Facebook Page identity`;
   - never accept an arbitrary actor ID for a partner connection.
6. Privacy policy:
   - require the customer's own valid HTTPS privacy-policy URL for Instant Form
     publishing;
   - do not default to Blockwise's product privacy page as if it were the
     customer's policy;
   - if destination mode does not require an Instant Form, apply the existing
     validator's actual rules rather than inventing a requirement.
7. Currency/timezone:
   - derive from Graph assignment;
   - display the values and make them read-only for partner setup unless Meta
     returned no value and the validator allows a controlled fallback.
8. Reconnect:
   - Settings links to `/connect-meta?mode=reconnect`; validate that exact query
     value server-side and derive the reconnect view state explicitly;
   - do not redirect a connected partner workspace away from `/connect-meta`
     when reconnect was requested;
   - `Reconnect the same assets` calls an atomic reconnect RPC that marks the
     existing provider row `not_connected`, increments request generation,
     retains the assignment, audits the change, and sends it back through live
     operator verification; explain the brief connection downtime before the
     confirmation action;
   - `Use different assets` first performs the safe local disconnect, then an
     operator removes the now-unreferenced assignment, then the customer starts
     a new generation with new expected IDs. Do not silently swap an assignment
     underneath an active connection.
9. Disconnect:
   - confirm workspace-local impact;
   - call a service-role `meta_partner_disconnect` RPC with connection ID,
     request generation/version, and assignment ID/version;
   - atomically mark only that provider row `not_connected`, transition
     `connected -> cancelled`, retain the assignment for audit/reconnect, and
     insert `meta.partner.disconnected` audit;
   - no partner provider-vault row exists; keep the one runtime-vault token
     untouched;
   - repeated calls return the prior disconnected result; stale versions return
     409; audit/DB failure returns failure rather than false completion;
   - tell the customer to remove Blockwise in Meta too if they want to revoke
     asset sharing at the source.
10. Existing OAuth connection behavior and metadata must continue to work.

#### Verification

```powershell
npm test -- --test-name-pattern="meta setup|instagram actor|meta reconnect|partner disconnect"
npm run typecheck
npm run test
```

#### Exit criteria

- Instagram can be selected only when linked to the assigned Page.
- `Connected` and `Ready to publish` are not conflated.
- Reconnect no longer redirects in a loop.
- Partner disconnect cannot affect another workspace.
- OAuth disconnect regression tests still pass.

#### Rollback

Disable partner starts and default new connections to OAuth. Retain partner
runtime loading and the safe partner-disconnect branch. Existing partner
connections remain visible in settings for operator assistance.

---

### Step 7 — Security, tenant-isolation, accessibility, and end-to-end gate

- **Model tier:** strongest available
- **PR:** `test/meta-partner-release-gate`
  **Depends on:** Step 6

#### Cold-start context

The workflow crosses customer auth, operator auth, global Meta assets, private
tokens, workspace assignments, settings, and publishing. Unit tests alone are
not sufficient.

#### Test inventory

Add or extend:

- `tests/meta-partner.test.ts` — config/capability helpers and error mapping;
- `tests/meta-partner-status-route.test.ts` — workspace-only status output;
- `tests/meta-partner-request-route.test.ts` — state transitions and roles;
- `tests/meta-partner-claim-route.test.ts` — spoof resistance and durability;
- `tests/meta-partner-operator-route.test.ts` — candidate filtering and
  conflicts;
- `tests/meta-partner-disconnect.test.ts` — zero global revocation;
- `tests/meta-partner-tenant-isolation.test.ts` — two-workspace matrix;
- `tests/meta-partner-token-vault.test.ts` — single runtime RPC use, no partner
  per-connection token copy, rotation, and no plaintext persistence;
- SQL tests for RLS/grants/constraints;
- `e2e/meta-partner-connect.spec.ts` — customer/operator handoff on the isolated
  controlled VPS staging stack;
- `scripts/seed-meta-partner-e2e.mjs` and cleanup companion — create two
  customer workspaces, owner/admin/member identities, one operator, requests,
  exact isolated fixture assets, and remove them after the suite.

#### One allowed deployed E2E strategy

Automated E2E uses a dedicated VPS staging Compose project, hostname, database,
and storage bucket containing no production/customer data. Add a fixture Graph
adapter, but make startup refuse it unless all are true:

- `BLOCKWISE_DEPLOYMENT_ROLE=meta-e2e`;
- `META_GRAPH_ADAPTER=fixture`;
- `NEXT_PUBLIC_APP_URL` exactly equals the committed staging hostname allowlist;
- provider writes are false;
- the dedicated database contains an environment marker created only by the E2E
  seed migration.

Production and normal staging builds must reject `fixture`. The fixture adapter
is selected only behind this server-only startup guard, never by an HTTP header,
cookie, query parameter, user role, or browser input. Live Meta proof remains
Step 0/canary; automated E2E never spends or contacts Meta. Store Playwright
auth state only in ignored temporary output, seed with explicit test passwords,
and run cleanup in `finally` plus a scheduled stale-fixture cleanup.

Add `@axe-core/playwright` as a dev dependency and add the exact package script:
`"test:e2e:meta": "playwright test e2e/meta-partner-connect.spec.ts"`.

#### Required test cases

1. Owner can start; admin can start; member/viewer cannot start.
2. Customer A cannot read or mutate request/assignment/connection for B.
3. Operator can see global candidates; customers cannot.
4. Same ad account cannot be assigned to two workspaces.
5. Spoofed account name/currency/timezone in claim input has no effect.
6. Missing campaign-management capability blocks claim.
7. Missing Page blocks claim.
8. Instagram linked to a different Page is excluded/rejected.
9. Inactive ad account is excluded/rejected.
10. Invalid system token produces needs-help, not connected.
11. Rate limit respects retry timing and preserves state.
12. Partial database/vault failure never returns success.
13. Repeated request, assignment, claim, and disconnect calls are idempotent.
14. Partner disconnect A leaves partner connection B healthy.
15. OAuth disconnect still calls its expected revoke behavior.
16. Reload at every customer state reconstructs the same state.
17. Polling stops when hidden/unmounted/complete/timed out.
18. Keyboard-only flow works end to end.
19. 320px reflow has no horizontal document scroll.
20. Reduced-motion mode has no transform-based entrances.
21. Screenshot alt text/captions are present and screenshot links open full size.
22. No token-like values appear in responses, logs, snapshots, or fixtures.
23. Publish preflight accepts a ready partner connection and still creates only
    PAUSED Meta objects.
24. The fixture adapter cannot start with a production hostname/database marker.
25. Active-provider uniqueness and every request/assignment/claim CAS survive
    concurrent calls.
26. Axe reports zero serious/critical issues on every durable customer state
    and the operator assignment state.
27. Focus moves to each new step heading, modal focus is trapped/restored,
    status changes use `role=status`, errors use `role=alert`, controls are at
    least 44×44 CSS px, and reduced-motion removes nonessential transitions.

#### Commands

```powershell
npm run check:nul
npm run test
npm run typecheck
npm run test:db
npm run build
```

After deploying the isolated controlled VPS E2E stack:

```powershell
$env:PLAYWRIGHT_BASE_URL='https://<controlled-meta-e2e-host>'
npm run test:e2e:meta
```

Run the Impeccable final gates on that deployed stack:

- `audit` — accessibility, responsive, performance;
- `critique` — task clarity and truthful state;
- `harden` — errors, roles, reloads, edge cases;
- `optimize` — only if screenshots or polling cause measurable regressions;
- `polish` — one bounded desktop/mobile pass.

#### Exit criteria

- Every command passes.
- The isolated controlled VPS staging hostname—not localhost—is the automated
  runtime acceptance environment; Step 0 and canary provide separate live Meta
  acceptance.
- Zero serious/critical accessibility findings.
- No cross-workspace data exposure.
- No plaintext/provider token leakage.
- PAUSED-only publish invariant remains intact.

#### Rollback

Test-only changes can be reverted, but a failed gate blocks release. Do not skip
or quarantine a security/tenant-isolation failure.

---

### Step 8 — Canary release and operating runbook

- **Model tier:** strongest available
- **PR:** `release/meta-partner-assisted-connection`
  **Depends on:** Step 7

#### Cold-start context

This is an assisted early-customer path with a shared platform credential and a
human assignment step. Release to one workspace before broad exposure.

#### Tasks

1. Add `docs/runbooks/meta-partner-assisted-onboarding.md` with:
   - customer prerequisites;
   - Blockwise Business ID location;
   - system-user/app/token prerequisites;
   - vault provisioning and rotation procedure;
   - operator request queue procedure;
   - asset assignment checklist;
   - customer confirmation/setup checklist;
   - error-code remediation table;
   - disconnect/revocation procedure;
   - emergency kill switch;
   - App Review/OAuth cutover procedure.
2. Add a service-role-only `meta_partner_health_snapshots` record and a VPS
   scheduled job that probes at most every 15 minutes with a ten-second timeout.
   The probe validates token decryption, expected app/system-user identity,
   proof receipt freshness, access tier/scopes, and one harmless account read.
   An operator-authenticated route reads the cached record only; no HTTP request
   may decrypt/probe Meta live. Its response contains boolean/configured state,
   stable code, checked/next-check timestamps, and proof expiry—never token
   material, last four digits, raw Meta errors, or asset IDs. Public health
   returns only generic service health.
3. Before enabling starts, the runbook must name an incident owner, backup, and
   alert destination. Alert on two consecutive health failures, proof expiry
   within seven days, any tenant-isolation/audit failure, orphaned claim lease,
   or queue age over one business hour.
4. Provision `meta_partner` token through the private-vault script and rehearse
   the one-row rotation/rollback on staging.
5. Configure the isolated VPS staging stack first and pass Step 7.
6. Select one friendly genuinely external workspace as the live canary; place
   only its UUID in partner-start and partner-write allowlists. Keep the default
   new-connection method OAuth until canary evidence is accepted.
7. Run the complete real handoff:
   customer share → request → operator assignment → customer claim → setup →
   reporting read → one approved PAUSED publish in a disposable/canary campaign.
8. Run at least three complete cycles over a 24-hour soak, including one
   disconnect/reconnect and one induced retryable failure. Expansion requires:
   - request queue latency;
   - no ambiguous assignment;
   - no cross-workspace candidate exposure;
   - reporting sync succeeds or reports a recoverable error;
   - Page/Instagram identity matches;
   - disconnect is workspace-local;
   - zero security/tenant/audit failures, zero false-connected states, zero
     leaked credentials, zero orphan Meta objects, zero unexpired claim leases,
     and zero unexpected active objects;
   - p95 request-to-assignment under one business hour and non-induced Graph
     failure rate below 5%.
9. Expand to at most five early customer workspaces only after the canary passes.
10. Connection-only rollout keeps global provider writes false. For the live
    PAUSED publish proof, enable the existing global gate only in the isolated
    canary environment and require the partner write allowlist in code; never
    enable a global production write flag to test one workspace. Connection
    success alone never authorizes live spend or activation.

#### Production verification

- Confirm migrations applied.
- Confirm runtime token vault row exists.
- Confirm controlled VPS image/checkout reports the reviewed commit SHA and the
  product migration allowlist contains/applied every new migration.
- Confirm request/assignment/provider rows are workspace-scoped.
- Confirm audit events exist for request, assignment, claim, setup, disconnect.
- Confirm the customer sees real asset names and no other customer's assets.
- Confirm the named alert destination has no unresolved partner incident and
  the cached health record is current.

#### Rollback

1. Set partner starts off, empty both partner allowlists, and keep new connection
   method OAuth.
2. Leave existing connected workspaces functional; do not revoke the shared
   token as a rollback shortcut.
3. Stop new requests and service current canary customers manually.
4. Roll code forward for data/state defects.
5. If token compromise is suspected, follow the runbook's one-row runtime-vault
   rotation procedure, verify expected identity/read canary, then invalidate the
   old token. There are no per-connection token copies to update.

#### Exit criteria

- Three real external canary cycles and the 24-hour soak meet every threshold.
- Operator runbook was followed by someone other than the implementer.
- Kill switch tested.
- No production secret exists outside approved vault storage.

---

### Step 9 — Prepare the OAuth cutover and partner-flow sunset

- **Model tier:** default implementation model
- **PR:** `docs/meta-oauth-cutover`
  **Depends on:** Step 8 and Meta approval timing

#### Cold-start context

The repository forbids temporary workarounds as the final architecture. Partner
connections may remain supported for already-connected customers, but new
connections should return to OAuth after Meta approval.

#### Tasks

1. Add an OAuth cutover checklist to the runbook:
   - App Review/Marketing API access approved;
   - required permissions/features active in Live mode;
   - redirect/deauthorize/data-deletion URLs verified;
   - non-app-role OAuth canary succeeds;
   - Page/ad/Instagram setup and PAUSED publish succeed;
   - OAuth disconnect works.
2. Set `BLOCKWISE_META_PARTNER_STARTS_ENABLED=false`, empty the partner-start
   allowlist, and set `BLOCKWISE_META_NEW_CONNECTION_METHOD=oauth`. The start,
   retry, and assignment APIs reject new partner generations; status and safe
   disconnect remain available.
3. Keep existing rows with `connectionMethod="partner_access"` loadable and
   operational through the runtime-vault resolver regardless of those onboarding
   controls.
4. Hide the customer partner guide for new workspaces while retaining a direct
   operator-assisted recovery path for existing partner rows.
5. Stop creating new partner requests/assignments.
6. After the last partner connection migrates or is revoked:
   - archive non-empty request/assignment tables under `legacy_archive` rather
     than dropping them;
   - remove screenshots and operator workflow in a dedicated cleanup PR;
   - remove `meta_partner` runtime token only after a transactionally consistent
     row-count report proves zero active/needs-attention partner connections and
     zero in-flight claims, and the report is attached to the cleanup PR;
   - retain audit history and migrations.

#### Verification

```powershell
npm run test
npm run typecheck
npm run build
```

Run both connection-method regression suites until the last partner connection
is retired.

#### Exit criteria

- New customers use approved OAuth.
- Existing partner customers are not broken by cutover.
- No shared token is removed while referenced.
- Cleanup uses measured row counts and archival rules.

## 9. File ownership map

Use this map to prevent parallel agents editing the same files.

| Workstream            | Files owned                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Platform/token safety | `src/lib/providers/meta-partner.ts`, `provider-connections.ts`, shared Graph client and every Meta token consumer, disconnect route, vault migration/scripts, root/product env examples, Compose |
| Request state         | request/assignment/active-provider migration, product migration allowlist, request library/route, partner status route, operator customer relation loader                                        |
| Capability/claim      | partner helper, claim route, setup filter, capability fixtures/tests                                                                                                                             |
| Operator UX           | operator assignment component/API and operator-specific tests                                                                                                                                    |
| Customer UX           | connect page, `src/components/meta/*`, copy config, production screenshot assets, E2E UI                                                                                                         |
| Setup/reconnect       | shared setup component, settings connections section, setup/disconnect route tests                                                                                                               |
| Release               | runbooks, cached health job/route, controlled VPS staging/product deployment notes                                                                                                               |

No two active implementation agents may own the same file. Agents are not
alone in the codebase; they must preserve and accommodate unrelated changes and
must not revert another agent's edits.

## 10. PR protocol for every step

1. Start from current `origin/main`:

```powershell
git fetch --all --prune
git switch main
git pull --ff-only
git switch -c <branch-from-step>
```

2. Confirm `.codegraph/` exists, run `codegraph status`, and `codegraph sync` if
   stale before locating code.
3. Read root `AGENTS.md`, `CLAUDE.md`, the relevant runbook, and this entire plan.
4. Keep each PR limited to the step's owned files and direct test/doc updates.
5. Never stage `.env*` except `.env.example`, databases, build output,
   `node_modules`, screenshots containing private data, or local agent state.
6. Run the step verification plus repository acceptance:

```powershell
npm run typecheck
npm run test
```

7. Deploy the reviewed commit to the isolated controlled VPS staging stack for
   every UI or runtime/API PR and execute its stated browser acceptance there.
   Localhost is not acceptance.
8. If a product migration changed, add it to
   `infra/product/product-migrations.txt`, apply it to the intended isolated
   self-hosted environment, and confirm the migration ledger before merge.
9. Open the PR with:
   - step number and plan link;
   - behavior change;
   - security/tenant-isolation analysis;
   - screenshots for UI work;
   - exact commands/results;
   - rollout/rollback notes.
10. Merge only after CI and required controlled-staging acceptance are green.
11. Run `hermes/skills/blockwise-agent-cleanup/SKILL.md` before handoff.

## 11. Anti-pattern catalog — reject these implementations

1. **Customer asset enumeration:** returning `/me/adaccounts`, Pages, or
   Instagram actors from the shared token to a customer browser.
2. **Name-based auto-binding:** assigning `Smith Realty` because the workspace
   is named `Smith Realty`.
3. **Readable means manageable:** treating a successful `GET id,name` as proof
   of campaign-write permission.
4. **Global revoke:** calling `/me/permissions` for a partner disconnect.
5. **Token in environment forever:** keeping the shared system token in process
   or Compose environment variables, per-connection vault rows, or docs.
6. **Token in logs:** logging Graph URLs containing `access_token`.
7. **Trusting browser metadata:** treating customer-submitted correlation IDs,
   names, currencies, or timezones as canonical without assignment/Graph proof.
8. **Optimistic connected state:** showing success before runtime-token health,
   provider row, request state, audit, and capability checks are durable.
9. **Infinite spinner:** polling forever or polling while the tab is hidden.
10. **False browser behavior:** saying `we opened Meta` before a user click.
11. **Missing Page:** guiding only ad-account sharing even though Page access is
    required.
12. **Instagram consumer account:** accepting an unlinked personal Instagram
    account or arbitrary actor ID.
13. **Third-party screenshots without rights:** shipping the mockup's external
    screenshots as production assets.
14. **Fake Meta UI:** redrawing controls and presenting them as current Meta
    screenshots.
15. **Parallel design system:** custom CSS/buttons/cards on the customer route.
16. **Reconnect redirect loop:** redirecting explicit reconnect back to settings.
17. **Blockwise privacy substitution:** using Blockwise's privacy page as the
    customer's Instant Form privacy policy.
18. **App-review promise:** telling customers partner access guarantees an App
    Review bypass.
19. **Live write during connection:** creating active campaigns to test access.
20. **Broad destructive cleanup:** deleting assignments, provider rows, or vault
    entries across workspaces during rollback.
21. **Best-effort security audit:** completing request/assignment/claim/disconnect
    when its required audit insert failed.
22. **Unsafe E2E bypass:** selecting the fixture Graph adapter from a request or
    allowing it to start against a non-E2E hostname/database.
23. **Global write canary:** enabling Meta writes for every workspace to test one
    partner workspace.
24. **Operator design-system mixing:** importing customer shadcn/Tailwind
    controls into the legacy operator route.

## 12. Plan mutation protocol

This plan may change only through an explicit amendment in this file.

For every mutation:

1. Add a dated entry under `Plan amendments`.
2. State the new evidence that invalidated the old instruction.
3. Name affected steps and dependency edges.
4. Choose one mutation type:
   - `split`: divide a step because its PR is too broad;
   - `insert`: add a prerequisite or safety gate;
   - `reorder`: move steps without violating dependencies;
   - `skip`: only when objective is already met and verified elsewhere;
   - `abandon`: stop because platform or product assumptions failed.
5. Update the dependency graph, file ownership map, tests, and rollback.
6. Never silently weaken a security invariant, release gate, or Step 0 stop
   condition.

### Plan amendments

#### 2026-08-31 — adversarial cold-start review

- **Evidence:** repository inspection found conflicting Vercel/VPS authority;
  campaign-only proof did not cover the product; request transitions were
  contradictory; claim writes were non-atomic; global candidates could be
  misbound; the shared token was copied/query-stringed; and rollout/E2E/canary
  controls were not independently expressible.
- **Mutation types:** `insert` Prerequisite A and external full-path proof gates;
  `split` Step 1 into safe-disconnect and token/config PRs; strengthen Steps 2–9.
- **Affected edges:** all implementation depends on Prerequisite A → Step 0;
  all product UI still depends on the state/capability/operator contracts.
- **Resolution:** controlled VPS target, exact-ID correlation, versioned/leased
  CAS state machine, atomic fail-closed audit RPCs, single runtime-vault token,
  header-only Graph client, isolated fixture E2E, workspace canary allowlists,
  measurable soak, and separate OAuth-onboarding/partner-runtime semantics.

## 13. Definition of done

The project is complete only when all are true:

- Step 0's independently reviewed, unexpired receipt proves a non-app-role
  external account can complete the full PAUSED product path, reporting, test
  lead retrieval, and cleanup with the intended system-user path.
- Customer owner/admin can follow reuse-approved Blockwise-operated screenshots
  (or the approved text fallback) and create a durable request.
- Operator can safely select and bind the correct account and Page without
  exposing the global pool.
- Customer confirms exact asset names before claim.
- Campaign-management, Page, and optional linked-Instagram access are verified.
- Provider/request/assignment/audit writes finalize atomically; partner rows
  reference the one runtime-vault token and never copy it.
- `Connected` and `Ready to publish` are truthfully distinct.
- Partner reconnect works; partner disconnect is workspace-local.
- OAuth behavior remains intact.
- All typecheck, unit, DB, build, controlled-VPS E2E, accessibility, desktop,
  and mobile gates pass.
- Three external canary cycles and the 24-hour soak meet every release threshold.
- Runbook, kill switch, token rotation, rollback, and OAuth sunset procedures
  exist and were exercised.
