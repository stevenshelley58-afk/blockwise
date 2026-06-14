import assert from "node:assert/strict";
import test from "node:test";

import {
  belongsToMailbox,
  buildReplySubject,
  getOperatorMailboxConfig,
  parseEmailRecipients,
  textToHtml,
} from "../src/lib/operator/email-service.ts";

test("operator mailbox config defaults to steven at the Blockwise domain", () => {
  const config = getOperatorMailboxConfig({ ...process.env, RESEND_API_KEY: "re_test" });

  assert.equal(config.mailboxAddress, "steven@blockwise.sale");
  assert.equal(config.mailboxDomain, "blockwise.sale");
  assert.equal(config.mailboxLabel, "All @blockwise.sale");
  assert.equal(config.fromAddress, "Steven at Blockwise <steven@blockwise.sale>");
  assert.equal(config.replyAddress, "steven@blockwise.sale");
  assert.equal(config.configured, true);
});

test("parseEmailRecipients accepts comma, semicolon, and newline separated recipients", () => {
  assert.deepEqual(parseEmailRecipients("alex@example.com; sam@example.com\nalex@example.com"), [
    "alex@example.com",
    "sam@example.com",
  ]);
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
