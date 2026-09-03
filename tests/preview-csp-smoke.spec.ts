import { expect, test } from "@playwright/test";

const previewUrl = process.env.PREVIEW_URL ?? "";

test.beforeAll(() => {
  const url = new URL(previewUrl);
  if (url.protocol !== "https:" || /^(localhost|127\\.0\\.0\\.1|::1)$/i.test(url.hostname)) {
    throw new Error("PREVIEW_URL must be an HTTPS Vercel Preview URL, never localhost");
  }
});

test("deployed Preview sends a narrow CSP without browser violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy|refused to load/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  const response = await page.goto(previewUrl, { waitUntil: "domcontentloaded" });
  expect(response).not.toBeNull();
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("private_ranges");
  await expect(page.locator("body")).toBeVisible();
  expect(violations).toEqual([]);
});
