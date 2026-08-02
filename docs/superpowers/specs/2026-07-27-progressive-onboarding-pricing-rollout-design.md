# Progressive Onboarding, Pricing, and Customer Operations

Date: 2026-07-27
Status: Owner-approved direction; implementation requested
Markets: United States and Australia

## 1. Outcome

Blockwise will replace its form-first trial and separate onboarding wizard with
one progressive activation journey. A new customer gives only an email at the
start. Blockwise asks for the website, Brand Pack review, template inputs, Meta
connection, payment details, profile details, and team members only when each
item unlocks the next useful action.

The same activation state will drive:

- public website calls to action;
- the authenticated home page and Ad Studio;
- free and paid generation entitlements;
- Meta connection and first-campaign publishing;
- Stripe checkout and subscription transitions;
- onboarding-call booking;
- customer profile and workspace settings;
- operator queues, interventions, and audit history.

There will not be a second onboarding system, a parallel generator, or a
separate trial-only workspace experience.

## 2. Approved Offer

### Self-serve with assistance

| Market | First paid month | Following months | Currency |
|---|---:|---:|---|
| United States | $99 | $499/month | USD |
| Australia | $99 | $499/month | AUD |

The self-serve plan includes:

- three free complete ad creations before payment;
- one free live-campaign setup after Meta connection and card collection;
- 100 render credits per paid month;
- up to 50 complete Feed and Story ad packs when every pack uses two renders;
- one Brand Pack, one workspace, and one Meta Business Portfolio with one
  primary ad account;
- five named, email-verified team members after payment;
- an optional onboarding call and support when the customer is blocked;
- campaign creation, publishing, reporting, and the Blockwise toolset;
- no included Meta ad spend.

The customer pays Meta directly from the connected ad account. Blockwise never
marks up or silently funds the customer's media spend.

### Managed service

Managed service is separate from the self-serve entitlement:

- United States: from $1,500/month plus ad spend;
- Australia: from A$2,500/month plus ad spend;
- the customer may book a call before paying or pay and book onboarding
  immediately;
- the base managed engagement includes the complete self-serve product,
  100 monthly render credits, one brand, one Meta ad account, operator launch
  and weekly optimization of up to four live campaigns, and a monthly report;
- scope beyond the standard engagement is confirmed and repriced during
  onboarding rather than being absorbed into self-serve support.

The managed price is not implemented as additional self-serve credits. It is a
distinct Stripe product and operator-managed service state.

## 3. Customer Journey

### 3.1 Email-only entry

Every high-intent public CTA opens the same email capture:

1. Customer enters an email address.
2. The page states that continuing accepts the Terms and Privacy Policy.
3. Supabase sends a magic link or one-time code.
4. Verification creates or resumes one customer profile and one trial
   workspace.
5. The customer lands on the next incomplete activation action.

Initial signup must not request a password, personal name, business name,
phone, team details, Meta access, or payment card.

Existing password users continue to work. Passwordless login becomes the
default for new and returning customers, without forcing an auth migration on
existing accounts.

### 3.2 Website and Brand Pack

The first authenticated action asks for:

- business website;
- country, defaulted from locale or website evidence but explicitly
  confirmable as United States or Australia.

Blockwise scans the website and builds the existing canonical Brand Pack. It
extracts the business name, logo, colours, typography, voice, contact details,
and relevant compliance text. The customer sees a concise review and can fix
wrong fields.

Brand Pack approval is required before the first customer generation. A failed
scan falls back to the existing Brand Studio with the minimum necessary fields;
it never sends the customer back to a general-purpose onboarding wizard.

### 3.3 Template and first ad

After Brand Pack approval:

1. Show localized, real-ad-derived templates.
2. The customer selects one template.
3. Ask only for the images and exact text declared by that template.
4. Generate the canonical Feed and Story ad pack through
   `buildCloneImageRequest`.
5. Persist the finished pack and expose the existing editor.

The trial grants six internal render credits, displayed to the customer as
**three free complete ads**. One complete Feed and Story pack consumes two
render credits. Failed provider work refunds the reservation automatically.

The customer may create, review, and edit without connecting Meta.

### 3.4 Meta branch

The Meta connection request appears when the customer chooses **Run this ad**,
not during initial signup.

If the customer has a Meta ad account:

1. Connect the Meta Business Portfolio.
2. Select the Facebook Page, Instagram account when applicable, and ad
   account.
3. Confirm campaign objective, audience, budget, schedule, destination, and
   lead form.
4. Continue to card collection.

If the customer has no Meta ad account:

- preserve the finished creative and every completed step;
- offer a clear self-serve Meta setup guide;
- offer **Subscribe and book onboarding**;
- allow a pre-purchase call;
- resume directly at connection after the account is ready.

Blockwise may guide the customer through creating their Meta assets but does
not accept Meta's legal terms, impersonate the customer, or take ownership of
their business assets.

### 3.5 Card collection and first live campaign

Before the free live campaign launches, Stripe Checkout:

- collects and validates a payment method;
- shows the exact auto-renewal schedule;
- records acceptance of the self-serve terms;
- creates a trialing subscription with a seven-day trial;
- attaches the market-specific first-invoice discount.

Customer-facing consent text:

> One live campaign setup is free. Your Meta ad spend is separate. Your
> Blockwise subscription starts at US$99/A$99 when the campaign launches or
> seven days after checkout, whichever comes first, then renews at
> US$499/A$499 monthly until cancelled.

Publishing and charging are ordered as follows:

1. Validate the Stripe subscription is trialing with a reusable payment method.
2. Validate the free live-campaign claim is still available.
3. Create and reconcile the Meta campaign idempotently.
4. Mark the free live-campaign claim used.
5. End the Stripe trial immediately.
6. Stripe invoices the first month at 99 in the workspace currency.

If the customer does not publish, Stripe ends the trial seven days after
checkout and invoices 99. If Meta publishing fails, Blockwise does not consume
the free live claim or end the Stripe trial.

### 3.6 Paid activation

When the first invoice is paid:

- grant 100 render credits for the billing period;
- unlock invitations for four additional members;
- unlock the paid usage and billing settings;
- show onboarding booking until completed or dismissed;
- replace activation prompts with the normal home experience.

The next successful renewal is 499 in the workspace currency.

Every return visit resolves the next incomplete action from server-side state
and provides one primary CTA. Customers never repeat completed steps.

## 4. Credits and Entitlements

### 4.1 Customer-visible rules

- Trial: three complete Feed and Story ads.
- Paid: 100 render credits per billing period.
- Feed render: one credit.
- Story render: one credit.
- AI image regeneration or AI image edit: one credit.
- Deterministic copy edits and deterministic text-layer patches: no credit.
- Failed or cancelled provider work: automatic refund.
- Credits expire at the end of the billing period.
- Credits do not roll over or transfer.
- Cancellation stops future grants; already-paid credits remain until the
  current period ends.

The UI always shows both:

- render credits remaining;
- an explanatory estimate such as “enough for up to 37 Feed + Story packs.”

### 4.2 Durable ledger

Replace the trial-only ad-pack counter as the final authority with one atomic
credit system used by trial and paid work:

- `workspace_credit_wallets`: one wallet per workspace and entitlement period;
- `workspace_credit_ledger`: append-only grants, reservations, settlements,
  refunds, expirations, and operator adjustments;
- unique mutation keys on every ledger operation;
- server-only reservation and settlement functions;
- workspace-scoped RLS and service-role mutation;
- no client-side arithmetic as an authorization check.

The existing `reserve_trial_ad_pack_credit` path is migrated into the shared
ledger. It must not remain as a parallel source of truth.

Generation reserves the exact number of renders before dispatch. Successful
provider calls settle reservations; failure paths refund them. Duplicate HTTP,
queue retries or webhook delivery returns the original ledger result.

## 5. Identity, Team, and Anti-Sharing Controls

### 5.1 Seats

- Trial workspace: one owner.
- Paid self-serve workspace: owner plus four invited members.
- Each member has an individual verified email and session.
- All members share the same Brand Pack, Meta connection, campaigns, and
  credit wallet.
- Inviting a member never grants more credits.
- Existing workspace roles and audit attribution remain authoritative.

### 5.2 Business binding

One self-serve subscription is bound to:

- one workspace;
- one Brand Pack and primary website;
- one country and billing currency;
- one Meta Business Portfolio;
- one primary Meta ad account.

The free live campaign may be claimed once across the connected Meta Business
Portfolio and ad account, not once per email or workspace. A durable claim
registry enforces this independently of customer deletion or a second signup.

Additional unrelated brands, Meta businesses, or client accounts require
another paid workspace or a managed/agency agreement.

### 5.3 Abuse signals

Server-side risk signals include:

- repeated trials against one website domain;
- repeated trials or free-live claims against one Meta business/ad account;
- duplicate Stripe customer or payment-method fingerprints;
- rapid unrelated Brand Pack changes;
- excessive parallel generation;
- repeated failed or disposable-email signup patterns.

IP and device signals may increase review risk but never serve as the sole
identity or denial rule. Legitimate offices and teams commonly share networks.

Trial work is limited to one concurrent generation; paid self-serve work is
limited to two. Operator overrides require a reason and an audit event.

## 6. Stripe Design

### 6.1 Products and prices

Create separate Stripe products/prices for:

- self-serve USD monthly: $499;
- self-serve AUD monthly: A$499;
- managed USD monthly: from $1,500;
- managed AUD monthly: from A$2,500.

Create market-specific once-only discounts:

- USD: $400 off the first self-serve invoice;
- AUD: A$400 off the first self-serve invoice.

Self-serve Checkout uses the normal 499 recurring price, the once-only
market discount, and a seven-day trial requiring a payment method. Ending the
trial on first successful Meta launch produces the 99 first invoice without a
custom second billing system.

Managed Checkout uses the market's base recurring price. The Checkout page and
service terms state the included scope above, that Meta ad spend is separate,
and that additional brands, ad accounts, or campaign volume require a written
scope change.

### 6.2 Tax, receipts, and trial disclosures

Enable Stripe Tax for Checkout and subscriptions. Price tax behavior is
explicit rather than inherited:

- USD prices are tax-exclusive; Stripe adds applicable United States sales tax
  based on the validated billing address and Blockwise's active registrations.
- AUD prices are tax-inclusive so A$99 and A$499 remain the customer-visible
  totals, including GST where Blockwise is required to collect it.

Collect the billing address in Checkout and support business tax IDs where
relevant. Stripe calculates tax only for jurisdictions configured in the
Blockwise Stripe account; registration obligations remain an owner/accountant
review item rather than application logic.

Checkout repeats the exact trigger and renewal terms beside the payment button.
Send the receipt after every charge and a reminder before the seven-day trial
would convert automatically. Record the accepted offer version, timestamp,
market, currency, first-month amount, renewal amount, and triggering rule.

### 6.3 Webhooks and reconciliation

Handle at minimum:

- `checkout.session.completed`;
- `customer.subscription.created`;
- `customer.subscription.updated`;
- `customer.subscription.deleted`;
- `invoice.paid`;
- `invoice.payment_failed`;
- charge refund/dispute events relevant to access.

Every webhook is:

- signature-verified;
- stored with its Stripe event ID;
- idempotent;
- applied through a billing domain service;
- reconciled back to Stripe when local state is ambiguous.

The app never upgrades a workspace based only on the Checkout redirect. The
webhook or an explicit Stripe retrieval is authoritative.

Failed first payment keeps the workspace and creative history, removes paid
credit grants, blocks new generation and publish work, and presents payment
recovery. Existing Meta campaigns are not silently stopped; the operator is
alerted and the customer receives explicit guidance.

### 6.4 Portal and cancellation

Customer billing settings provide Stripe's hosted portal for:

- payment method changes;
- invoices;
- cancellation;
- supported plan changes.

Cancellation and renewal dates are shown in Blockwise from Stripe state.
Operator controls call Stripe first and reconcile back; they do not directly
edit subscription columns.

## 7. Customer Product Surfaces

### 7.1 Public website

Update the homepage, pricing page, signup entry, FAQs, Terms, and relevant
campaign CTAs to state:

- email-only start;
- three free complete ads;
- no card until the customer wants to run the campaign;
- one free live campaign setup;
- Meta spend paid separately;
- 100 monthly render credits and up to 50 complete Feed + Story packs;
- five team members;
- 99 first month, then 499 in local currency;
- managed service starting prices;
- pay-and-book or call-first managed onboarding.

Country switching must be explicit and accessible. Geolocation may choose the
initial display but never silently chooses the Stripe price.

### 7.2 Authenticated home

Replace the generic setup checklist with one activation card sourced from the
activation resolver. It shows:

- the next required action;
- completed milestones;
- credit balance;
- plan and billing timing;
- Meta connection state;
- onboarding booking state.

The full app remains accessible where safe. Publishing, invitations, and
generation are gated by entitlements, not hidden behind a forced tour.

### 7.3 Profile and settings

Personal Profile:

- verified email;
- preferred name, requested only after first value or when booking;
- optional phone;
- timezone;
- security/session controls.

Workspace:

- business name and website;
- country and billing currency;
- Brand Pack;
- team and roles;
- Meta business, Page, Instagram account, and ad account;
- onboarding-call state.

Plan and Usage:

- current plan and subscription status;
- current and next invoice;
- trial/free-live state;
- render credits granted, used, reserved, and remaining;
- billing-period dates;
- Stripe portal;
- managed-service upgrade.

Country/currency changes after Checkout or Meta connection require an
operator-assisted workspace migration because Stripe prices and regional
compliance behavior are already bound.

## 8. Booking and Assistance

Use Cal.com as the initial hosted scheduler behind a provider adapter rather
than embedding booking logic throughout the app:

- one configured public onboarding event type per market;
- customer-facing booking route after Checkout and in Settings;
- provider webhook records booked, rescheduled, cancelled, and completed;
- operator queue shows customers who paid but have not booked;
- reminder email after 24 hours and again before the session;
- rescheduling link remains provider-owned.

Configure the US and Australian booking URLs and webhook secret through
environment variables. The adapter stores provider-neutral booking IDs and
states so the provider can change later. If webhook credentials are not yet
available, the launch-safe fallback still opens the correct hosted booking
page and lets the operator mark attendance; webhook automation is then listed
as an explicit deployment blocker rather than silently pretending booking is
connected.

## 9. Operator Customer Management

Add a customer operations area to the existing operator shell.

### 9.1 Customer list

Columns and filters:

- customer/workspace;
- country;
- lifecycle stage and next action;
- self-serve or managed plan;
- Stripe state;
- credits remaining;
- Brand Pack state;
- Meta connection and free-live claim;
- onboarding booking;
- last activity;
- risk/review state.

Priority queues:

- email verified but no website;
- Brand Pack scan failed;
- generated but not connected to Meta;
- no Meta ad account/help requested;
- Checkout incomplete;
- paid but onboarding not booked;
- Meta publish failed;
- payment failed;
- low credits/high usage;
- managed customer requiring work.

### 9.2 Customer detail

Tabs:

- overview and next action;
- activation timeline;
- billing and invoices;
- credit ledger;
- Brand Pack;
- Meta connections and publish plans;
- campaigns and generation costs;
- team;
- bookings and assistance notes;
- audit history.

### 9.3 Operator actions

All actions use services, reason codes, idempotency, and audit logs:

- resend verification or recovery email;
- grant or reverse credits;
- suspend/resume new generation;
- mark abuse review;
- retry Brand Pack extraction;
- guide/retry Meta connection;
- retry safe publish reconciliation;
- open Stripe customer/subscription;
- initiate a Stripe-authorized refund or cancellation;
- resend booking link;
- mark onboarding completed;
- convert to/from managed service through Stripe;
- enter the workspace with existing operator attribution.

The operator UI does not expose raw database editing.

## 10. Activation State and Data Ownership

Create one server-owned activation record per self-serve workspace containing
monotonic milestone timestamps and the few choices that cannot be derived:

- email verified;
- country confirmed;
- website submitted;
- Brand Pack approved;
- first template selected;
- first ad pack generated;
- Meta help path selected;
- Meta connected;
- Checkout completed;
- free-live claim reserved/consumed;
- first campaign live;
- intro invoice paid;
- onboarding booked/completed;
- activation completed.

Source systems remain authoritative for their domain:

- Supabase Auth for identity and email verification;
- Brand Pack tables for brand readiness;
- provider connections for Meta state;
- campaigns/publish plans for creative and live state;
- Stripe for subscription and invoices;
- credit ledger for generation entitlement;
- booking provider/webhook for appointment state.

`resolveCustomerActivation` combines these sources and returns:

- current stage;
- next action;
- allowed actions;
- resume path;
- progress for display;
- operator blockers.

Milestones are written only by the owning domain transaction. The resolver can
repair a stale milestone from authoritative data; it does not let the client
declare completion.

## 11. APIs, Jobs, and Idempotency

New or revised domain boundaries:

- progressive auth/workspace bootstrap;
- activation resolver and milestone recorder;
- Brand Pack extraction and approval;
- credit reservation/settlement/refund;
- entitlement check;
- Stripe Checkout, portal, webhook, and reconciliation;
- free-live claim reservation/settlement;
- booking adapter and webhook;
- operator customer queries and audited actions.

Every external or expensive mutation accepts a stable idempotency key:

- workspace bootstrap by verified auth user;
- Brand Pack scan by workspace and normalized URL;
- generation by workspace and client mutation ID;
- Stripe Checkout creation by workspace and offer;
- free-live claim by Meta business/ad account;
- Meta publish plan by campaign;
- booking webhook by provider event ID;
- operator adjustment by operator mutation ID.

Long-running generation and publish tasks remain on the existing production
execution paths. Vercel never performs Hermes scraping.

## 12. Error and Recovery Behavior

- Expired email link: one-click resend with the email retained.
- Existing email: send login link without disclosing account existence.
- Website scan failure: preserve URL, explain the failure, retry, or enter the
  minimum Brand Pack manually.
- Generation failure: settle/refund atomically and keep inputs.
- Credit exhaustion: preserve the draft and show the exact renewal/upgrade
  path.
- Meta has no eligible assets: show which Page/business/ad account is missing
  and route to guide or assistance.
- OAuth interruption: return to the exact activation stage.
- Checkout abandonment: preserve the campaign and resume at Checkout.
- Stripe webhook delay: show “Confirming payment” and reconcile; never grant
  from the redirect alone.
- Publish failure: do not consume the free-live claim or trigger billing.
- Booking failure: keep paid access, present the fallback link, and alert the
  operator.
- Partial Feed/Story success: charge only settled renders, preserve the
  successful format, and offer retry for the missing format.

## 13. Analytics and Success Measures

Track server-confirmed events by country and acquisition source:

- CTA clicked;
- email submitted;
- email verified;
- website submitted;
- Brand Pack approved;
- template selected;
- first generation started/completed;
- third free ad completed;
- Meta prompt shown;
- Meta connected;
- Meta help requested;
- Checkout started/completed;
- free campaign launched;
- first invoice paid;
- onboarding booked/completed;
- first renewal paid;
- managed inquiry/checkout;
- cancellation and payment failure.

Primary funnel metrics:

- email-submit to verification rate;
- verification to Brand Pack completion;
- time to first generated ad;
- first-generation completion rate;
- generated-ad to Meta-connect rate;
- Meta-connect to Checkout rate;
- Checkout to free-live launch;
- free-live launch to first invoice;
- first invoice to first renewal;
- support minutes per self-serve customer;
- provider cost per render and per complete pack;
- abuse-review and false-positive rates.

## 14. Rollout

### Phase 0: Foundations behind flags

- tested migrations and backfills;
- activation resolver;
- shared credit ledger;
- Stripe test products, prices, discounts, portal, and webhooks;
- regional offer configuration;
- audit and analytics contracts.

No public copy changes until the entitlement and billing paths pass in Stripe
test mode.

### Phase 1: Progressive first value

- email-only magic-link signup;
- verified workspace bootstrap;
- website-first Brand Pack;
- localized template handoff;
- three free complete ads;
- authenticated next-action home card;
- recovery and analytics.

### Phase 2: Conversion and settings

- Meta connection at **Run this ad**;
- no-account help branch;
- Stripe card collection and seven-day trigger;
- one free-live claim;
- first and recurring invoices;
- 100-credit paid wallet;
- profile, team, billing, usage, and connection settings.

### Phase 3: Operator and assistance

- customer list, detail, queues, audit, credit, billing, Meta, and booking
  actions;
- booking-provider integration and reminders;
- managed-service product, Checkout, booking, and operator workflow.

### Phase 4: Public launch

- website and pricing copy;
- updated FAQs, Terms, Privacy, and managed-service terms;
- production Stripe prices/webhooks;
- Meta production configuration;
- operator runbook and alerts;
- staged exposure followed by United States and Australia availability.

## 15. Verification and Release Gates

Automated:

- migration and RLS tests;
- auth/bootstrap tests;
- activation transition and resume tests;
- atomic credit concurrency/idempotency tests;
- generation reserve/settle/refund tests;
- Stripe webhook signature, ordering, replay, discount, trial, cancellation,
  and payment-failure tests;
- free-live uniqueness tests across emails/workspaces;
- Meta OAuth return-path and publish reconciliation tests;
- operator authorization/audit tests;
- website pricing/copy tests;
- `npm run typecheck`;
- `npm run test`;
- AdStudio hard-reset and template verification gates.

Production/preview:

- Vercel Preview desktop at 1440×900;
- Vercel Preview mobile at 390×844 and reflow at 320px;
- keyboard, screen reader, focus return, contrast, reduced motion, and touch
  targets;
- fresh-user journey in both USD and AUD Stripe test clocks;
- Meta-connected and no-Meta-account branches;
- duplicate generation, Checkout, webhook, and publish delivery;
- paid team invitation to the fifth seat and rejection of the sixth;
- cancellation, payment failure, booking failure, and recovery;
- operator queue and audited intervention;
- final production smoke on `blockwise.sale`.

Runtime acceptance occurs on Vercel Preview or Production URLs, never
localhost. Supabase migrations, Stripe webhooks, Vercel Cron routes, and VPS
queue handlers are deployed and confirmed before production promotion.

## 16. Explicit Non-goals

- No free Meta ad spend.
- No unlimited brands or client accounts in self-serve.
- No credit rollover, transfer, or per-seat credit multiplication.
- No password requirement during initial signup.
- No separate trial generator.
- No second Brand Pack or template architecture.
- No browser-side entitlement authority.
- No operator database editor.
- No automatic ownership of customer Meta assets.
- No weakening of AdStudio template or hard-reset verification.
