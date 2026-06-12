import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  alternates: { canonical: "/privacy" },
  description:
    "How Blockwise collects, stores, uses, and deletes data — including data accessed through Meta Marketing API and lead form submissions.",
};

export const dynamic = "force-static";

export default function PrivacyPolicyPage() {
  return (
    <>
      <p style={{ color: "#475569", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Last updated: 28 May 2026
      </p>
      <h1 style={{ fontSize: 36, margin: "8px 0 24px", fontWeight: 600 }}>Privacy Policy</h1>

      <p>
        Blockwise (&ldquo;Blockwise&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is a B2B real estate
        advertising workflow tool operated from Australia. This policy explains what personal data we
        collect, why we collect it, how we store and use it, and how you can request a copy or have it
        deleted. It applies to <strong>www.blockwise.sale</strong> and to the Blockwise application at
        <strong> app.blockwise.sale</strong>.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>1. Who this policy is for</h2>
      <p>
        Blockwise has two distinct user groups, and the data we hold for each differs:
      </p>
      <ul>
        <li>
          <strong>Real estate agents and agency staff</strong> who sign in to Blockwise to plan,
          approve, and review advertising campaigns.
        </li>
        <li>
          <strong>Members of the public who submit a Meta Lead Ad form</strong> created by a Blockwise
          customer (an agent). Blockwise processes that lead data on behalf of the agent so they can
          contact the prospective seller.
        </li>
      </ul>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>
        2. Data we collect from Blockwise customers (agents)
      </h2>
      <ul>
        <li>Account profile: email address, name, workspace name, role.</li>
        <li>Authentication metadata managed by Supabase.</li>
        <li>
          Advertising configuration: brand kit, target suburbs, ad copy you write or approve, lead
          form questions, lead destination preferences.
        </li>
        <li>Audit history of approvals, publishes, and configuration changes.</li>
      </ul>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>
        3. Data we access through the Meta Marketing API
      </h2>
      <p>
        When you connect a Meta Business ad account to Blockwise, we receive an OAuth access token
        from Meta with your consent. The token is encrypted at rest with AES-256-GCM using a key
        managed in our application secrets, and is only decrypted in memory at the moment a Meta API
        request is being made on your behalf. Using that token, Blockwise reads or writes the
        following Meta data:
      </p>
      <ul>
        <li>
          <strong>Ad account metadata</strong> (ID, currency, timezone) so we can show the agent which
          account they connected.
        </li>
        <li>
          <strong>Facebook Pages you administer</strong> (name, ID), so the agent can pick which Page
          will host the lead ads.
        </li>
        <li>
          <strong>Campaign, ad set, and ad objects</strong> we create on your account. These are
          always created in PAUSED state. We never create, activate, or modify a campaign without
          a separate in-application human approval.
        </li>
        <li>
          <strong>Lead form submissions</strong> you have authorized us to retrieve from forms
          Blockwise created on your behalf — see Section 4 below.
        </li>
        <li>
          <strong>Insights data</strong> (impressions, reach, clicks, spend, leads) for campaigns
          Blockwise manages on your account, so we can show you live performance inside Blockwise
          Monitor.
        </li>
      </ul>
      <p>
        We do not use Meta data for purposes other than running and reporting on the campaigns you
        have explicitly created in Blockwise. We do not sell or share Meta data with any third party
        other than the infrastructure providers listed in Section 6.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>
        4. Data we collect from members of the public who submit a lead form
      </h2>
      <p>
        If you have submitted a Meta Lead Ad form created by a real estate agent who uses Blockwise,
        the agent has used Blockwise to fetch your submission from Meta and store it inside their
        Blockwise workspace. The fields stored depend on the form the agent built but typically
        include: name, phone number, email address, suburb, and any free-text answers you provided.
        Blockwise acts as a processor of this data on behalf of the agent (the controller).
      </p>
      <p>
        If you wish to access, correct, or delete this data, you should contact the agent directly.
        You may also contact us at <a href="mailto:privacy@blockwise.sale">privacy@blockwise.sale</a>
        {" "}and we will forward the request to the agent and, on confirmation, delete the data from
        our systems.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>5. Retention</h2>
      <ul>
        <li>Account and configuration data: retained while your Blockwise workspace is active.</li>
        <li>
          Meta access and refresh tokens: stored encrypted and rotated on Meta&rsquo;s schedule;
          deleted within 30 days of you disconnecting the integration.
        </li>
        <li>
          Lead submissions: retained for 24 months by default and then anonymised, unless the agent
          deletes them sooner or you exercise your deletion right.
        </li>
        <li>Audit logs: retained for 24 months for security and dispute resolution.</li>
      </ul>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>6. Sub-processors</h2>
      <p>We use the following infrastructure providers, who are contractually bound to confidentiality:</p>
      <ul>
        <li>Vercel (application hosting)</li>
        <li>Supabase (authentication, application database, encrypted storage)</li>
        <li>Trigger.dev (background job execution)</li>
        <li>OpenAI / OpenRouter (large language model inference for ad copy generation)</li>
        <li>Cloudflare (egress filtering and AI gateway)</li>
      </ul>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>
        7. Requesting Data Deletion
      </h2>
      <p>
        You have the right to request that we delete all data we hold from or about you. There are
        three ways to do this:
      </p>
      <ol>
        <li>
          <strong>If you are a Blockwise customer:</strong> open your workspace settings and click
          &ldquo;Delete workspace&rdquo;. This permanently removes your workspace, all configuration,
          all stored Meta tokens, and all stored lead submissions within 30 days.
        </li>
        <li>
          <strong>If you submitted a Meta Lead Ad form created by a Blockwise customer:</strong>{" "}
          email <a href="mailto:privacy@blockwise.sale">privacy@blockwise.sale</a> with the subject
          &ldquo;Delete my data&rdquo; and tell us the agency or agent who ran the ad. We will route
          the request to the agent and delete the data from our systems within 30 days of
          confirmation.
        </li>
        <li>
          <strong>If you are a Facebook user who connected Blockwise:</strong> you can revoke
          Blockwise&rsquo;s access from your Facebook account&rsquo;s &ldquo;Business
          Integrations&rdquo; settings. Meta will notify Blockwise through our Data Deletion Callback
          (<code>/api/integrations/meta/data-deletion</code>), and we will delete the associated
          data within 30 days and return a confirmation code that you can use to track the
          deletion at <a href="mailto:privacy@blockwise.sale">privacy@blockwise.sale</a>.
        </li>
      </ol>
      <p>
        Deletion requests are normally completed within 30 days. Some backup systems may retain a
        copy for up to 90 days before being permanently overwritten.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>8. Security</h2>
      <p>
        All traffic to Blockwise uses HTTPS. Access tokens for third-party providers, including Meta,
        are encrypted at rest with AES-256-GCM. Production access is restricted to named personnel
        with two-factor authentication.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>9. Contact</h2>
      <p>
        Privacy questions: <a href="mailto:privacy@blockwise.sale">privacy@blockwise.sale</a>
        <br />
        General contact: <a href="mailto:hello@blockwise.sale">hello@blockwise.sale</a>
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>10. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. The &ldquo;Last updated&rdquo; date at the top
        reflects the most recent revision. Material changes will be notified to active customers by
        email.
      </p>
    </>
  );
}
