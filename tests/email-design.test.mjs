import assert from "node:assert/strict";
import test from "node:test";

import { EMAIL_FIXTURES, EMAIL_KINDS } from "../src/lib/email-design/fixtures.ts";
import { EMAIL_DESIGNS, escapeHtml, renderEmail, safeHref } from "../src/lib/email-design/renderer.ts";

test("every fixture renders in every design within the email size budget", () => {
  for (const kind of EMAIL_KINDS) {
    for (const design of EMAIL_DESIGNS) {
      const rendered = renderEmail(EMAIL_FIXTURES[kind], design);
      assert.ok(rendered.html.startsWith("<!doctype html>"));
      assert.ok(rendered.html.length < 20_000, `${kind}/${design} is ${rendered.html.length} bytes`);
      assert.ok(rendered.text.includes(EMAIL_FIXTURES[kind].heading));
      assert.ok(rendered.html.includes('role="presentation"'));
      assert.ok(rendered.html.includes('min-height:44px'));
      assert.ok(rendered.html.includes('meta name="color-scheme"'));
      assert.ok(rendered.html.includes("prefers-color-scheme:dark"));
      assert.ok(!rendered.html.includes('class="email-force-dark"'));
      assert.equal(/<script\b/i.test(rendered.html), false);
      assert.equal(/<img\b/i.test(rendered.html), false);
      assert.equal(/@font-face|fonts\.google|font-family:[^;]*(https?:|url\()/i.test(rendered.html), false);
    }
  }
});

test("renderer escapes interpolated content and rejects unsafe action protocols", () => {
  const message = {
    ...EMAIL_FIXTURES.welcome,
    heading: '<img src=x onerror="bad">',
    action: { label: '<b>open</b>', href: "javascript:alert(1)" },
  };
  const rendered = renderEmail(message, "quiet-card");
  assert.ok(rendered.html.includes("&lt;img src=x onerror=&quot;bad&quot;&gt;"));
  assert.ok(rendered.html.includes("&lt;b&gt;open&lt;/b&gt;"));
  assert.ok(rendered.html.includes('href="#"'));
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  assert.equal(safeHref("https://example.com/path"), "https://example.com/path");
  assert.equal(safeHref("javascript:alert(1)"), "#");
});

test("transactional and marketing footers remain distinct", () => {
  const receipt = renderEmail(EMAIL_FIXTURES.receipt, "operations-brief").html;
  const digest = renderEmail(EMAIL_FIXTURES["weekly-digest"], "operations-brief").html;
  assert.ok(receipt.includes("service email"));
  assert.equal(receipt.includes("Unsubscribe"), false);
  assert.ok(digest.includes("Manage preferences"));
  assert.ok(digest.includes("Unsubscribe"));
});
