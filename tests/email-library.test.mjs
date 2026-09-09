import assert from "node:assert/strict";
import test from "node:test";
import { EMAIL_TEMPLATES, EMAIL_CATEGORIES, LAUNCH_TEMPLATE_IDS, buildTemplate, requiredVariables } from "../src/lib/email-design/catalog.ts";
import { exampleVariables, renderExample, exampleStates } from "../src/lib/email-design/examples.ts";

const productionValues = id => JSON.parse(JSON.stringify(exampleVariables(id)).replaceAll("preview.blockwise.example", "blockwise.sale").replace("Blockwise · Sample business address. Replace before sending", "Test business identity for validation"));

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
    if (["daily-digest", "weekly-performance", "new-lead"].includes(template.id)) {
      assert.ok((result.html.match(/<img\b/gi) ?? []).length >= 1);
      assert.match(result.html, /<img[^>]+alt="[^"]+"/i);
      assert.ok(result.html.includes("https://blockwise.sale/email-preview/email-assets/"));
    } else assert.ok(!/<script\b|<img\b|@font-face|url\(/i.test(result.html));
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


test("notification templates are independent opt-ins with scoped footers", () => {
  const keys = new Set(); const links = new Set();
  for (const id of ["daily-digest", "weekly-performance", "new-lead"]) {
    const definition = EMAIL_TEMPLATES.find(item => item.id === id);
    assert.equal(definition.delivery, "optional-service");
    assert.equal(definition.message.transactional, false);
    keys.add(definition.notificationPreference.key);
    links.add(exampleVariables(id).unsubscribe_url);
    const rendered = renderExample(id);
    assert.ok(rendered.html.includes(definition.notificationPreference.unsubscribeLabel));
    assert.ok(rendered.text.includes(definition.notificationPreference.unsubscribeLabel));
    assert.ok(rendered.html.includes("You chose"));
  }
  assert.equal(keys.size, 3); assert.equal(links.size, 3);
});

test("daily and weekly reports render normal, zero-activity and delayed-data states", () => {
  for (const id of ["daily-digest", "weekly-performance"]) {
    assert.deepEqual(exampleStates(id), ["standard", "quiet", "delayed"]);
    for (const state of exampleStates(id)) for (const theme of ["system", "light", "dark"]) {
      const rendered = renderExample(id, theme, state);
      assert.ok(rendered.bytes < 25000);
      assert.ok(!/undefined|\{\{|NaN|Infinity|<script|—/.test(rendered.html));
      if (state === "quiet") {
        assert.ok(rendered.text.includes("New leads: 0"));
        assert.ok(rendered.text.includes("Cost per lead: Not available"));
        assert.ok(!rendered.text.includes("Alex Morgan"));
      }
      if (state === "delayed") {
        assert.ok(rendered.text.includes("New leads: Pending"));
        assert.ok(rendered.text.includes("Missing data is not treated as zero"));
        assert.ok(!rendered.text.includes("A$84.00"));
      }
    }
  }
  assert.throws(() => renderExample("new-lead", "system", "quiet"), /Unknown example state/);
});

test("summary values and activity rows are safely escaped and preserved in plaintext", () => {
  const values = productionValues("daily-digest");
  const result = buildTemplate("daily-digest", { ...values, report_lead_count: '<b>4</b>', activity_items: [{ layout: "list-item", heading: '<img src=x>', body: 'A & B' }] });
  assert.ok(result.html.includes("&lt;b&gt;4&lt;/b&gt;"));
  assert.ok(result.html.includes("&lt;img src=x&gt;"));
  assert.ok(result.text.includes("A & B"));
  assert.ok(!result.html.includes("<img src=x"));
  assert.throws(() => buildTemplate("daily-digest", { ...values, activity_items: [{ layout: "script", heading: "Bad", body: "Bad" }] }), /Invalid section layout/);
});


test("notification visuals carry real fixture charts and ads, then clear for quiet or delayed states", () => {
  const daily = renderExample("daily-digest");
  const weekly = renderExample("weekly-performance");
  assert.match(daily.html, /Morning/); assert.match(daily.html, /Evening/);
  assert.match(weekly.html, /Tue/); assert.match(weekly.html, /Mon/);
  assert.ok((weekly.html.match(/sample-(?:seller-appraisal|buyer-demand)\.jpg/g) ?? []).length >= 2);
  for (const id of ["daily-digest", "weekly-performance"]) for (const state of ["quiet", "delayed"]) {
    const rendered = renderExample(id, "system", state);
    assert.ok(!/<img\b|<svg\b/i.test(rendered.html), id + " " + state);
    assert.ok(!/Morning|Tue|sample-seller|sample-buyer/i.test(rendered.html), id + " " + state);
  }
});

test("visual inputs fail closed at the chart and ad boundaries", () => {
  const values = productionValues("daily-digest");
  const chart = { kind: "line", title: "Daily leads", unit: "Leads", values: [{ label: "A", value: 1 }] };
  for (const value of [NaN, Infinity, -1, 1.5, 1000001]) assert.throws(() => buildTemplate("daily-digest", { ...values, chart: { ...chart, values: [{ label: "A", value }] } }), /chart|value/i);
  assert.throws(() => buildTemplate("daily-digest", { ...values, chart: null }), /chart/i);
  assert.throws(() => buildTemplate("daily-digest", { ...values, chart: { ...chart, title: "" } }), /title/i);
  assert.throws(() => buildTemplate("daily-digest", { ...values, chart: { ...chart, unit: "x".repeat(41) } }), /unit/i);
  assert.throws(() => buildTemplate("daily-digest", { ...values, chart: { ...chart, values: Array.from({ length: 8 }, (_, i) => ({ label: String(i), value: 0 })) } }), /7/i);
  const ad = { src: "https://blockwise.sale/email-preview/email-assets/sample-seller-appraisal.jpg", alt: "Sample ad", label: "Sample" };
  assert.throws(() => buildTemplate("daily-digest", { ...values, ad_previews: [ad, ad, ad] }), /2/i);
  assert.throws(() => buildTemplate("daily-digest", { ...values, ad_previews: [{ ...ad, src: "http://blockwise.sale/ad.jpg" }] }), /HTTPS/i);
  assert.throws(() => buildTemplate("daily-digest", { ...values, ad_previews: [{ ...ad, detail: "x".repeat(161) }] }), /detail/i);
  assert.throws(() => buildTemplate("daily-digest", { ...values, ad_previews: [{ ...ad, width: 0 }] }), /dimension/i);
  assert.throws(() => buildTemplate("daily-digest", { ...values, ad_previews: [{ ...ad, width: 2401 }] }), /dimension/i);
  assert.throws(() => buildTemplate("daily-digest", { ...values, ad_previews: [{ ...ad, src: "https://preview.blockwise.example/ad.jpg" }] }), /URL/i);
});


test("visual fixtures reconcile, survive plaintext, and never appear as fallback data", () => {
  for (const [id, total] of [["daily-digest", 4], ["weekly-performance", 18]]) {
    const values = exampleVariables(id);
    assert.equal(values.chart.values.reduce((sum, item) => sum + item.value, 0), total);
    assert.equal(Number(values.report_lead_count), total);
    const output = renderExample(id);
    assert.ok(output.text.includes(values.chart.title));
    assert.ok(output.text.includes(values.chart.unit));
    for (const item of values.chart.values) assert.ok(output.text.includes(`${item.label}: ${item.value}`));
    for (const ad of values.ad_previews) {
      assert.ok(output.text.includes(ad.label));
      assert.ok(output.text.includes(ad.alt));
      if (ad.detail) assert.ok(output.text.includes(ad.detail));
    }
    const without = productionValues(id); delete without.chart; delete without.ad_previews;
    const plainReport = buildTemplate(id, without);
    assert.doesNotMatch(plainReport.html, /<img\b|class="chart-table"/);
    for (const section of without.activity_items) assert.ok(plainReport.html.includes(section.heading));
  }
  const week = exampleVariables("weekly-performance");
  assert.deepEqual(week.chart.values.map(item => item.label), ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"]);
  assert.ok(renderExample("weekly-performance").html.includes(week.lead_comparison));
  const lead = renderExample("new-lead");
  assert.ok(lead.html.indexOf('class="action') > lead.html.indexOf('<img '));
});

test("visual text is escaped and validated, including controls and placeholders", () => {
  const values = productionValues("daily-digest");
  const base = values.chart;
  for (const invalid of ["\u0000", "{{missing}}", ""]) {
    for (const key of ["title", "unit"]) assert.throws(() => buildTemplate("daily-digest", { ...values, chart: { ...base, [key]: invalid } }));
    assert.throws(() => buildTemplate("daily-digest", { ...values, chart: { ...base, values: [{ label: invalid, value: 1 }] } }));
  }
  const output = buildTemplate("daily-digest", { ...values, chart: { ...base, title: "<em>Lead & count</em>" } });
  assert.ok(output.html.includes("&lt;em&gt;Lead &amp; count&lt;/em&gt;"));
  assert.doesNotMatch(output.html, /<em>Lead/);
  const ad = values.ad_previews[0];
  const custom = buildTemplate("daily-digest", { ...values, ad_previews: [{ ...ad, width: 1200, height: 600 }] });
  assert.match(custom.html, /width="52" height="26"/);
  assert.throws(() => buildTemplate("daily-digest", { ...values, ad_previews: [{ ...ad, width: 640, height: undefined }] }), /dimension/i);
  assert.throws(() => buildTemplate("new-lead", { ...productionValues("new-lead"), chart: base }), /chart/i);
  assert.throws(() => buildTemplate("welcome", { ...productionValues("welcome"), ad_previews: [ad] }), /visual/i);
});


test("approved masthead, inset footer and compact capsule cover the complete catalogue", () => {
  for (const template of EMAIL_TEMPLATES) for (const mode of ["system", "light", "dark"]) {
    const { html, text } = renderExample(template.id, mode);
    assert.equal((html.match(/class="email-header body-cell"/g) ?? []).length, 1, template.id);
    assert.equal((html.match(/class="muted email-footer body-cell"/g) ?? []).length, 1, template.id);
    assert.ok(html.indexOf('class="email-header body-cell"') < html.indexOf("<h1"), template.id);
    assert.ok(html.indexOf('class="muted email-footer body-cell"') > html.indexOf("<h1"), template.id);
    assert.ok(html.includes('.header-mark{background:#ffffff!important}'), template.id);
    for (const action of html.matchAll(/<a[^>]+class="action [^"]*"[^>]+>/g)) {
      assert.match(action[0], /display:inline-block/);
      assert.match(action[0], /min-height:44px/);
      assert.match(action[0], /border-radius:999px/);
      assert.doesNotMatch(action[0], /display:block/);
    }
    assert.ok(text.length > 0);
  }
});


test("new lead follows supplied contact-first reference and validates contact actions", () => {
  const output = renderExample("new-lead");
  for (const label of ["Phone", "Email", "Property address", "Looking to sell", "Property type", "Anything else"]) assert.ok(output.html.includes(label));
  assert.ok(output.html.indexOf("Anything else") < output.html.indexOf("<img "));
  assert.match(output.html, /href="tel:\+61400123456"/);
  assert.match(output.html, /href="mailto:sarah.mitchell@example.com"/);
  assert.match(output.html, /width="52"/);
  assert.match(output.html, /Call Sarah/);
  assert.doesNotMatch(output.html, /Related creative|Contact details and the full enquiry|Hi Jordan/);
  const values = productionValues("new-lead");
  assert.throws(() => buildTemplate("new-lead", {...values, lead_phone_number:"javascript:alert(1)"}), /phone/);
  assert.throws(() => buildTemplate("new-lead", {...values, lead_email:"test@example.com?bcc=other@example.com"}), /email/);
  assert.ok(output.text.includes("0400 123 456"));
  assert.ok(output.text.includes("Anything else"));
});

test("reports use adaptive raster line charts with independent HTML data fallback", () => {
  for (const id of ["daily-digest", "weekly-performance"]) {
    const output = renderExample(id);
    assert.match(output.html, /class="chart-light"/);
    assert.match(output.html, /class="chart-dark"/);
    assert.doesNotMatch(output.html, /class="chart-bar|<svg/);
    const values = productionValues(id);
    delete values.chart.imageUrl;
    delete values.chart.darkImageUrl;
    delete values.ad_previews;
    const fallback = buildTemplate(id, values);
    assert.doesNotMatch(fallback.html, /<img/);
    for (const point of values.chart.values) assert.ok(fallback.html.includes(point.label));
    assert.throws(() => buildTemplate(id, {...values, chart: {...values.chart, imageUrl:"javascript:alert(1)"}}), /URL|HTTPS/);
    assert.throws(() => buildTemplate(id, {...values, chart: {...values.chart, kind:"bars"}}), /chart/);
  }
});

test("launch collection contains unique valid templates", () => {
  assert.equal(LAUNCH_TEMPLATE_IDS.length, 23);
  assert.equal(new Set(LAUNCH_TEMPLATE_IDS).size, 23);
  for (const id of LAUNCH_TEMPLATE_IDS) assert.ok(EMAIL_TEMPLATES.some(t => t.id === id), id);
});
