import assert from "node:assert/strict";
import test from "node:test";

import {
  belongsToMailbox,
  buildReplySubject,
  getOperatorMailboxConfig,
  normalizeOperatorEmailContacts,
  parseEmailRecipients,
  textToHtml,
} from "../src/lib/operator/email-service.ts";

test("operator mailbox config defaults to steven at the Blockwise domain", () => {
  const config = getOperatorMailboxConfig({ ...process.env, EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test" });

  assert.equal(config.mailboxAddress, "steven@blockwise.sale");
  assert.equal(config.mailboxDomain, "blockwise.sale");
  assert.equal(config.mailboxLabel, "All @blockwise.sale");
  assert.equal(config.fromAddress, "Steven at Blockwise <steven@blockwise.sale>");
  assert.equal(config.replyAddress, "steven@blockwise.sale");
  assert.equal(config.configured, true);
});

test("reports inbound and outbound capabilities separately", () => {
  const smtp = getOperatorMailboxConfig({ EMAIL_PROVIDER: "smtp", SMTP_HOST: "stalwart.internal" } as unknown as NodeJS.ProcessEnv);
  assert.equal(smtp.outboundConfigured, true);
  assert.equal(smtp.inboundConfigured, false);
  assert.equal(smtp.configured, false);
});
test("parseEmailRecipients accepts comma, semicolon, and newline separated recipients", () => {
  assert.deepEqual(parseEmailRecipients("alex@example.com; sam@example.com\nalex@example.com"), [
    "alex@example.com",
    "sam@example.com",
  ]);
});

test("normalizeOperatorEmailContacts returns named, sorted, unique users with valid email addresses", () => {
  assert.deepEqual(
    normalizeOperatorEmailContacts([
      { id: "2", full_name: " Zoe Agent ", email: "ZOE@example.com" },
      { id: "1", full_name: "Amelia Hart", email: "amelia@example.com" },
      { id: "3", full_name: null, email: "amelia@example.com" },
      { id: "4", full_name: null, email: "sam@example.com" },
      { id: "5", full_name: "No Email", email: null },
    ]),
    [
      { id: "1", name: "Amelia Hart", email: "amelia@example.com" },
      { id: "4", name: "sam@example.com", email: "sam@example.com" },
      { id: "2", name: "Zoe Agent", email: "zoe@example.com" },
    ],
  );
});

test("belongsToMailbox filters exact addresses and whole-domain mailboxes", () => {
  assert.equal(belongsToMailbox({ to: ["Steven@Blockwise.Sale"] }, "steven@blockwise.sale"), true);
  assert.equal(belongsToMailbox({ to: ["hello@blockwise.sale"] }, "steven@blockwise.sale"), false);
  assert.equal(belongsToMailbox({ to: ["hello@blockwise.sale"] }, "blockwise.sale"), true);
  assert.equal(belongsToMailbox({ to: ["legal@blockwise.sale", "someone@example.com"] }, "blockwise.sale"), true);
  assert.equal(belongsToMailbox({ to: ["someone@example.com"] }, "blockwise.sale"), false);
});

test("buildReplySubject avoids duplicating the Re prefix", () => {
  assert.equal(buildReplySubject("Blockwise demo"), "Re: Blockwise demo");
  assert.equal(buildReplySubject("RE: Blockwise demo"), "RE: Blockwise demo");
});

test("textToHtml escapes HTML before building paragraphs", () => {
  assert.equal(textToHtml("Hi <script>\nthere\n\nThanks"), "<p>Hi &lt;script&gt;<br>there</p><p>Thanks</p>");
});
