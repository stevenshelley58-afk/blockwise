import type { Metadata } from "next";

import { formatBillingAmount, getBillingOffer } from "@/lib/billing/offers";

const US_SELF_SERVE = getBillingOffer("US", "self_serve");
const AU_SELF_SERVE = getBillingOffer("AU", "self_serve");
const US_MANAGED = getBillingOffer("US", "managed");
const AU_MANAGED = getBillingOffer("AU", "managed");
const FIRST_MONTH = `${formatBillingAmount(
  US_SELF_SERVE.firstInvoiceAmount,
  US_SELF_SERVE.currency,
)} / ${formatBillingAmount(AU_SELF_SERVE.firstInvoiceAmount, AU_SELF_SERVE.currency)}`;
const RENEWAL = `${formatBillingAmount(
  US_SELF_SERVE.recurringAmount,
  US_SELF_SERVE.currency,
)} / ${formatBillingAmount(AU_SELF_SERVE.recurringAmount, AU_SELF_SERVE.currency)}`;
const MANAGED_MONTHLY = `${formatBillingAmount(
  US_MANAGED.recurringAmount,
  US_MANAGED.currency,
)} / ${formatBillingAmount(AU_MANAGED.recurringAmount, AU_MANAGED.currency)}`;

export const metadata: Metadata = {
  title: "Terms of Service",
  alternates: { canonical: "/terms" },
  description: "Terms of service for Blockwise, a real estate advertising workflow tool.",
};

export const dynamic = "force-static";

export default function TermsOfServicePage() {
  return (
    <>
      <p style={{ color: "#475569", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Last updated: 30 July 2026
      </p>
      <h1 style={{ fontSize: 36, margin: "8px 0 24px", fontWeight: 600 }}>Terms of Service</h1>

      <p>
        These terms govern your use of the Blockwise application and the
        <strong> www.blockwise.sale</strong> website (collectively, the &ldquo;Service&rdquo;). By
        signing in or otherwise using the Service, you agree to these terms.
      </p>
      <p>Blockwise is operated by SHELLEY, STEVEN JOHN.</p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>1. The Service</h2>
      <p>
        Blockwise is a B2B advertising workflow tool that helps Australian and US real estate agents
        plan, review, and publish lead generation campaigns to Meta&rsquo;s advertising platforms.
        Blockwise does not publish a campaign, change its budget, or export leads without the
        in-application approval required for that action.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>2. Your account</h2>
      <p>
        You must be at least 18 years old and authorized to act on behalf of the real estate agency
        whose ad account you connect. You are responsible for keeping your credentials secure and
        for the activity of any user you invite into your workspace.
      </p>
      <p>
        New accounts start with an email address and a magic link or one-time code. Continuing from
        the email entry and signing in means you accept these terms and our{" "}
        <a href="/privacy">Privacy Policy</a>. A self-serve trial has one owner. After payment, the
        workspace may have up to five named members, each using an individually verified email.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>3. Acceptable use</h2>
      <p>You agree not to use Blockwise to:</p>
      <ul>
        <li>
          Run advertising that violates Meta&rsquo;s Advertising Standards, the Fair Housing Act,
          the Australian Anti-Discrimination Act, or any other applicable law.
        </li>
        <li>
          Target audiences in a way that excludes protected classes from receiving housing
          advertising.
        </li>
        <li>
          Submit content that is unlawful, deceptive, infringing, or designed to harass any person.
        </li>
        <li>Attempt to reverse engineer, scrape, or interfere with the Service.</li>
      </ul>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>4. Third-party services</h2>
      <p>
        Blockwise integrates with Meta&rsquo;s Marketing API and Pages products, Stripe for billing,
        and Cal.com for hosted onboarding scheduling. Your use of those services is also governed by
        their terms. You are responsible for the content of any advertisement you publish through
        Blockwise and for accepting Meta&rsquo;s terms for your own business assets. Blockwise does
        not accept those terms for you, impersonate you, or take ownership of your Meta assets.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>
        5. Self-serve trial, credits, and billing
      </h2>
      <p>
        The free creation allowance includes three complete Feed and Story ads before Checkout. A
        complete ad normally uses two render credits. You do not need a card to create, review, or
        edit those ads. Failed or cancelled provider work is refunded to the applicable credit balance.
      </p>
      <p>
        When you choose to publish, Checkout collects a reusable payment method and starts a separate
        seven-day billing trial. The first paid month ({FIRST_MONTH}) begins when the first campaign
        launches or that billing trial ends, whichever comes first, then renews at {RENEWAL} monthly
        until cancelled. Your Meta ad spend is separate. United States prices exclude applicable
        sales tax. Australian prices include GST where Blockwise is required to collect it.
      </p>
      <p>
        A paid self-serve subscription grants 100 render credits per billing period. A Feed render,
        Story render, AI image regeneration, or AI image edit uses one credit. Deterministic copy
        edits and deterministic text-layer patches use no credit. Credits expire at the end of the
        billing period and do not roll over or transfer. Inviting a team member does not add
        credits.
      </p>
      <p>
        One self-serve subscription is for one workspace, one Brand Pack and primary website, one
        country and billing currency, one Meta Business Portfolio, and one primary Meta ad account.
        Additional unrelated brands, Meta businesses, or client accounts require another paid
        workspace or a managed or agency agreement.
      </p>
      <p>
        Meta bills advertising spend directly to your connected ad account. Meta spend is not
        included in the Blockwise subscription, marked up by Blockwise, or funded by Blockwise.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>
        6. Managed service
      </h2>
      <p>
        Managed service is separate from self-serve and costs {MANAGED_MONTHLY} per month in the
        workspace billing currency, plus Meta ad spend. You may book a call before paying, or pay
        and book onboarding immediately.
      </p>
      <p>
        The base managed engagement includes the complete self-serve product, 100 monthly render
        credits, one brand, one Meta ad account, operator launch and weekly optimization of up to
        four live campaigns, and a monthly report. Additional brands, ad accounts, campaign volume,
        or other work require a written scope change and may be repriced during onboarding.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>
        7. Cancellation, termination, and deletion
      </h2>
      <p>
        You may cancel through the Stripe-hosted billing portal. Cancellation stops future
        subscription renewals and future credit grants. Credits already paid for remain available
        until the current billing period ends, when they expire. Cancelling a subscription does not
        itself delete the workspace.
      </p>
      <p>
        If you separately delete your workspace, Blockwise will permanently delete the workspace
        and associated data within 30 days, subject to the retention and backup rules in our{" "}
        <a href="/privacy">Privacy Policy</a>. We may suspend or terminate access if you breach these
        terms.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>
        8. Warranties and limitation of liability
      </h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; without warranties of any kind. Blockwise will
        not be liable for indirect, incidental, or consequential damages arising from your use of
        the Service. Our total liability is capped at the fees you have paid us in the prior twelve
        months.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>9. Governing law</h2>
      <p>
        These terms are governed by the laws of Western Australia. Any disputes will be resolved in
        the courts of Western Australia.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>10. Contact</h2>
      <p>
        Questions about these terms: <a href="mailto:legal@blockwise.sale">legal@blockwise.sale</a>
      </p>
    </>
  );
}
