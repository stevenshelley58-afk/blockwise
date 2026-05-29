import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data Deletion · Blockwise",
  description:
    "How to request that Blockwise delete the data we hold about you, including data sourced from Meta lead forms.",
};

export const dynamic = "force-static";

export default function DataDeletionPage() {
  return (
    <>
      <p style={{ color: "#707470", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Last updated: 28 May 2026
      </p>
      <h1 style={{ fontSize: 36, margin: "8px 0 24px", fontWeight: 600 }}>Requesting Data Deletion</h1>

      <p>
        You have the right to request that Blockwise delete the data we hold from or about you. This
        page explains how to make a request, what to expect, and how Meta-initiated deletion
        callbacks are handled. For the full picture of what data we hold and why, see our
        {" "}<a href="/privacy">Privacy Policy</a>.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>
        Option 1 — You are a Blockwise customer (a real estate agent or agency staff member)
      </h2>
      <ol>
        <li>Sign in to your Blockwise workspace.</li>
        <li>Open Workspace Settings → Danger Zone → Delete Workspace.</li>
        <li>Type your workspace name to confirm.</li>
      </ol>
      <p>
        Blockwise will permanently delete your workspace, all configuration, all stored Meta tokens,
        and all stored lead submissions within 30 days. Encrypted backups roll off within 90 days.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>
        Option 2 — You submitted a lead form created by a Blockwise customer
      </h2>
      <p>
        If a real estate agent who uses Blockwise created the Meta lead form you filled out, Blockwise
        stores your submission on the agent&rsquo;s behalf. To request deletion:
      </p>
      <ol>
        <li>
          Email <a href="mailto:privacy@blockwise.sale">privacy@blockwise.sale</a> with the subject
          line &ldquo;Delete my data&rdquo;.
        </li>
        <li>
          Include: your name, your email or phone number as submitted, the name of the agency or
          agent, and (if known) the suburb or property the ad was for.
        </li>
      </ol>
      <p>
        We will confirm receipt within 5 business days, route your request to the agent
        (who is the controller of the data), and delete the data from our systems within 30 days of
        confirmation.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>
        Option 3 — Revoking Blockwise&rsquo;s access from your Facebook account
      </h2>
      <p>
        If you connected Blockwise to your Facebook account and want us to delete the data we hold:
      </p>
      <ol>
        <li>
          Go to Facebook → Settings &amp; Privacy → Settings → Business Integrations.
        </li>
        <li>Find Blockwise and click Remove.</li>
      </ol>
      <p>
        Meta will notify Blockwise through our Data Deletion Callback. Blockwise will queue a
        deletion of all data associated with your Facebook user ID and return a confirmation code.
        Deletion is normally completed within 30 days.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>For Meta App Review reviewers</h2>
      <p>
        Blockwise implements the Meta Data Deletion Callback at:
      </p>
      <p
        style={{
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          background: "#f5f5f3",
          padding: "12px 16px",
          borderRadius: 6,
        }}
      >
        POST https://blockwise.sale/api/integrations/meta/data-deletion
      </p>
      <p>
        The endpoint verifies the <code>signed_request</code> HMAC-SHA256 signature against
        <code> META_APP_SECRET</code>, queues an asynchronous deletion job for the supplied
        app-scoped user ID, and responds with a JSON body containing a status-tracking URL and a
        confirmation code, per Meta&rsquo;s specification.
      </p>

      <h2 style={{ fontSize: 22, marginTop: 32, fontWeight: 600 }}>Contact</h2>
      <p>
        Privacy questions: <a href="mailto:privacy@blockwise.sale">privacy@blockwise.sale</a>
        <br />
        General contact: <a href="mailto:hello@blockwise.sale">hello@blockwise.sale</a>
      </p>
    </>
  );
}
