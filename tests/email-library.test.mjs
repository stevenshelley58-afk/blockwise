import assert from "node:assert/strict";
import test from "node:test";
import { EMAIL_TEMPLATES, EMAIL_CATEGORIES, buildTemplate, requiredVariables } from "../src/lib/email-design/catalog.ts";
import { exampleVariables, renderExample } from "../src/lib/email-design/examples.ts";

const productionValues = id => JSON.parse(JSON.stringify(exampleVariables(id)).replaceAll("preview.blockwise.example", "blockwise.sale").replace("Blockwise · Sample business address — replace before sending", "Test business identity for validation"));

test("44 distinct templates cover seven categories and remain lean in every colour mode", () => {
  assert.equal(EMAIL_TEMPLATES.length, 44);
  assert.equal(new Set(EMAIL_TEMPLATES.map(t => t.id)).size, 44);
  assert.equal(EMAIL_CATEGORIES.length, 7);
  for (const template of EMAIL_TEMPLATES) for (const theme of ["system", "light", "dark"]) {
    const result = renderExample(template.id, theme);
    assert.ok(result.bytes < 25_000, `${template.id}: ${result.bytes}`);
    assert.ok(result.html.includes("<h1"));
    assert.ok(result.html.includes('width="100%"'));
    assert.ok(result.html.includes("max-width:600px"));
    assert.ok(result.html.includes("max-width:400px"));
    assert.ok(result.text.includes("The Blockwise team"));
    assert.ok(!/\{\{|undefined|\[object Object\]/.test(result.html), template.id);
    assert.ok(!/<script\b|<img\b|@font-face|url\(/i.test(result.html));
    assert.equal(result.html.includes("prefers-color-scheme:dark"), theme === "system");
    assert.equal(result.html.includes("Unsubscribe"), template.delivery !== "transactional");
    assert.equal(result.text.includes("Unsubscribe:"), template.delivery !== "transactional");
  }
});

test("production rendering requires real values, links, adaptive colours and safe subjects", () => {
  for (const template of EMAIL_TEMPLATES) {
    assert.throws(() => buildTemplate(template.id, exampleVariables(template.id)), /sample|real sending/);
    const values = productionValues(template.id);
    const result = buildTemplate(template.id, values);
    assert.ok(result.html.includes("prefers-color-scheme:dark"));
    assert.ok(result.html.includes("[data-ogsc] .mark"));
    for (const field of requiredVariables(template.id)) {
      const missing = { ...values }; delete missing[field];
      assert.throws(() => buildTemplate(template.id, missing), /Invalid|missing|Provide/);
    }
  }
  assert.throws(() => buildTemplate("not-a-template", {}), /Unknown/);
  assert.throws(() => buildTemplate("welcome", productionValues("welcome"), { colorMode: "dark" }), /adaptive/);
  const header = { ...productionValues("team-invitation"), workspace_name: "Bad\r\nBcc:bad@example.org" };
  assert.throws(() => buildTemplate("team-invitation", header), /subject/);
});

test("newsletter expands real sections with matching plaintext and rejects unsafe story links", () => {
  const values = productionValues("weekly-newsletter");
  const rendered = buildTemplate("weekly-newsletter", values);
  assert.ok(rendered.html.includes("Start with one clear offer"));
  assert.ok(rendered.text.includes("Start with one clear offer"));
  assert.ok(!rendered.html.includes('"repeat"'));
  const unsafe = structuredClone(values); unsafe.stories[0].link.href = "javascript:alert(1)";
  assert.throws(() => buildTemplate("weekly-newsletter", unsafe), /HTTPS/);
  for (const stories of [[], Array(6).fill(values.stories[0]), [{ heading: "Missing body" }]]) {
    assert.throws(() => buildTemplate("weekly-newsletter", { ...values, stories }), /stories|Invalid/);
  }
});

test("untrusted copy is escaped and sample or insecure destinations cannot become production links", () => {
  const values = productionValues("welcome");
  const rendered = buildTemplate("welcome", { ...values, first_name: '<img src=x onerror="alert(1)">' });
  assert.ok(rendered.html.includes("&lt;img")); assert.ok(!rendered.html.includes("<img"));
  for (const url of ["javascript:alert(1)", "http://blockwise.sale", "https://u:p@blockwise.sale", "https://example.com", "https://blockwise.test", "https://localhost", "https://preview.blockwise.example"]) {
    assert.throws(() => buildTemplate("welcome", { ...values, support_url: url }), /URL/);
  }
  assert.throws(() => buildTemplate("welcome", { ...values, first_name: "{{first_name}}" }), /placeholder/);
});
