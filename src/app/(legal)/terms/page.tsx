import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service · Blockwise",
  description: "Terms of service for Blockwise, a real estate advertising workflow tool.",
};

export const dynamic = "force-static";

export default function TermsOfServicePage() {
  return (
    <>
      <p style={{ color: "#475569", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Last updated: 28 May 2026
      </p>
      <h1 style={{ fontSize: 36, margin: "8px 0 24px", fontWeight: 600 }}>Terms of Service</h1>

      <p>
        These terms govern your use of the Blockwise application and the
        <strong> www.blockwise.sale</strong> website (collectively, the &ldquo;Service&rdquo;). By
        signing in or otherwise using the Service, you agree to these terms.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>1. The Service</h2>
      <p>
        Blockwise is a B2B advertising workflow tool that helps Australian and US real estate agents
        plan, review, and publish lead generation campaigns to Meta&rsquo;s advertising platforms.
        Blockwise creates campaign objects in your connected Meta ad account in PAUSED state and
        does not activate, modify budgets, or export leads without a separate in-application human
        approval.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>2. Your account</h2>
      <p>
        You must be at least 18 years old and authorized to act on behalf of the real estate agency
        whose ad account you connect. You are responsible for keeping your credentials secure and
        for the activity of any user you invite into your workspace.
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
        Blockwise integrates with Meta&rsquo;s Marketing API and Pages products. Your use of those
        services is also governed by Meta&rsquo;s terms. You are responsible for the content of any
        advertisement you publish through Blockwise.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>5. Billing</h2>
      <p>
        Blockwise charges a subscription fee for access to the workflow tool. Advertising spend on
        Meta is billed by Meta directly to your connected ad account and is not handled by
        Blockwise.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>6. Termination</h2>
      <p>
        You may stop using the Service at any time. If you delete your workspace, Blockwise will
        permanently delete your workspace and all associated data within 30 days, subject to the
        retention rules in our <a href="/privacy">Privacy Policy</a>. We may suspend or terminate
        access if you breach these terms.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>
        7. Warranties and limitation of liability
      </h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; without warranties of any kind. Blockwise will
        not be liable for indirect, incidental, or consequential damages arising from your use of
        the Service. Our total liability is capped at the fees you have paid us in the prior twelve
        months.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>8. Governing law</h2>
      <p>
        These terms are governed by the laws of Western Australia. Any disputes will be resolved in
        the courts of Western Australia.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>9. Contact</h2>
      <p>
        Questions about these terms: <a href="mailto:legal@blockwise.sale">legal@blockwise.sale</a>
      </p>
    </>
  );
}
