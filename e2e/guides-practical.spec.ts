import { expect, test } from "@playwright/test";

const slugs = [
  "seller-offer-ladder-real-estate-ads", "sold-price-list-seller-leads",
  "meta-lead-quality-crm-feedback-loop", "real-estate-creative-portfolio-meta-ads",
  "downsizing-ad-seller-leads", "meta-ads-algorithm-changes-real-estate",
  "lead-follow-up-playbook", "custom-list-facebook-ad-buyer-leads",
];

test("guide hub presents the starter guide without a mobile preamble", async ({ page }) => {
  await page.goto("/guides");
  const starter = page.locator('main a[href="/guides/sold-price-list-seller-leads"]').first();
  await expect(starter).toBeVisible();
  const box = await starter.boundingBox();
  expect(box!.y).toBeLessThan(page.viewportSize()!.height);
  for (const slug of slugs) {
    await expect(page.locator(`main a[href="/guides/${slug}"]`).first()).toBeVisible();
  }
  await expect(page.locator("main")).not.toContainText("Read the the");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const slug of slugs) {
  test(`${slug}: readable, navigable and usable resources`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const response = await page.goto(`/guides/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("main h1")).toBeVisible();
    const diagram = page.locator(".bw-article-hero-media");
    if (await diagram.count()) {
      expect((await diagram.boundingBox())!.height, "Summary diagram must not retain the old image-sized hero row").toBeLessThan(190);
    }
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://blockwise.sale/guides/${slug}`);
    const contents = page.locator(".bw-article-toc");
    await expect(contents).toBeVisible();
    const anchors = await contents.locator('a[href^="#"]').evaluateAll(links => links.map(link => link.getAttribute("href")!));
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(await page.locator(`[id="${anchor.slice(1)}"]`).count(), `Missing section ${anchor}`).toBe(1);
    }
    await contents.locator('a[href^="#"]').last().click();
    expect(new URL(page.url()).hash).toBe(anchors.at(-1));
    const resources = await page.locator('main a[download]').evaluateAll(links => links.map(link => ({ href: link.getAttribute("href")!, label: link.textContent?.trim() })));
    expect(resources.length, "Each guide needs a usable takeaway").toBeGreaterThan(0);
    for (const resource of resources) {
      expect(resource.href).toMatch(/^\/guides\/resources\//);
      expect(resource.label).toBeTruthy();
      const download = await page.evaluate(async href => {
        const response = await fetch(href);
        return { ok: response.ok, bytes: (await response.arrayBuffer()).byteLength };
      }, resource.href);
      expect(download.ok, `Missing resource ${resource.href}`).toBe(true);
      expect(download.bytes).toBeGreaterThan(50);
    }
    const snippets = page.getByRole("button", { name: /copy/i });
    if (await snippets.count()) {
      await snippets.first().click();
      await expect(page.getByRole("status").first()).toContainText(/copied|select|copy/i);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}


test("downsizer calculator calculates and rejects invalid funnels", async ({ page }) => {
  await page.goto("/guides/downsizing-ad-seller-leads");
  const calculator = page.locator('section[aria-labelledby="economics-calculator-title"]');
  const table = calculator.getByRole("table");
  await expect(table.getByRole("row").filter({ hasText: "Valid contacts" })).toContainText("70.0%");
  await expect(table.getByRole("row").filter({ hasText: "Valid contacts" })).toContainText("A$20.00");
  await expect(table).toContainText("Lead-to-listing rate: 5.0%");
  await expect(table).toContainText("Cost per listing: A$280.00");
  await calculator.getByLabel("Spend (A$)", { exact: true }).fill("560");
  await expect(table.getByRole("row").filter({ hasText: "Appraisals" })).toContainText("A$280.00");
  await calculator.getByLabel("Spend (A$)", { exact: true }).fill("");
  await expect(calculator.getByRole("alert")).toContainText("Enter a number");
  await expect(table).toHaveCount(0);
  await calculator.getByLabel("Spend (A$)", { exact: true }).fill("-1");
  await expect(calculator.getByRole("alert")).toContainText("Spend");
  await expect(table).toHaveCount(0);
  await calculator.getByLabel("Spend (A$)", { exact: true }).fill("0");
  await calculator.getByLabel("Valid contacts", { exact: true }).fill("21");
  await expect(calculator.getByRole("alert")).toContainText(/greater than/i);
  await calculator.getByLabel("Valid contacts", { exact: true }).fill("1.5");
  await expect(calculator.getByRole("alert")).toContainText("whole numbers");
  for (const label of ["Listings", "Appraisals", "Seller conversations", "Existing homeowners", "Valid contacts", "Leads"]) {
    await calculator.getByLabel(label, { exact: true }).fill("0");
  }
  await expect(calculator.getByRole("alert")).toHaveCount(0);
  await expect(table).toContainText("Lead-to-listing rate: —");
  await expect(table).not.toContainText(/NaN|Infinity/);
});

test("copy button copies the actual multiline draft", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/guides/sold-price-list-seller-leads");
  const block = page.locator(".bw-copy-block").filter({ has: page.getByRole("heading", { name: "Complete delivery email", exact: true }) });
  const expected = await block.locator(".bw-copy-block-text").textContent();
  expect(expected).toContain("\n\n");
  expect(expected).not.toContain("\\n");
  await block.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(block.getByRole("status")).toContainText("Copied to clipboard");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
});

test("copy failure provides a selectable fallback", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("Clipboard unavailable in test"); } } }));
  await page.goto("/guides/sold-price-list-seller-leads");
  const block = page.locator(".bw-copy-block").first();
  await block.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(block.getByRole("status")).toContainText("Select the text");
  await expect(block.locator(".bw-copy-block-text")).toHaveCSS("user-select", "text");
  await expect(block.locator(".bw-copy-block-text")).toHaveAttribute("tabindex", "0");
});
