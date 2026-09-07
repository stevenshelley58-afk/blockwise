import { test, expect } from "@playwright/test";

const adId = process.env.ADSTUDIO_E2E_AD_ID;
const workspaceId = process.env.ADSTUDIO_E2E_WORKSPACE_ID;
test.use({ storageState: process.env.ADSTUDIO_E2E_STORAGE_STATE ?? "/srv/blockwise/secrets/adstudio-e2e.storage-state.json" });

test("canonical PNG follows edits and every editor preview mode without saving", async ({ page }) => {
  test.setTimeout(120_000);
  expect(adId, "A dedicated test ad is required").toBeTruthy();
  expect(workspaceId, "A dedicated test workspace is required").toBeTruthy();
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  // This test may render but must never save, publish, or trigger a provider.
  await page.route("**/api/**", async route => {
    const request = route.request();
    if (["GET", "HEAD"].includes(request.method()) || request.url().includes("/preview?")) return route.continue();
    return route.abort();
  });
  await page.addInitScript(() => localStorage.setItem("bw-consent", "essential"));
  await page.goto("/ad-studio/ads/" + adId + "?workspaceId=" + workspaceId);
  await expect(page.getByRole("region", { name: "Ad Studio editor" })).toBeVisible();
  const feed = page.getByRole("img", { name: "Feed canonical server preview", exact: true });
  const story = page.getByRole("img", { name: "Story canonical server preview", exact: true });
  await expect(feed).toBeVisible({ timeout: 45_000 });
  await expect(feed).toHaveJSProperty("naturalWidth", 1080);
  await page.getByRole("tab", { name: "Story", exact: true }).click();
  await expect(story).toBeVisible({ timeout: 45_000 });
  await expect(story).toHaveJSProperty("naturalHeight", 1920);
  await page.getByRole("radio", { name: "Meta preview", exact: true }).click();
  await expect(story).toBeVisible();
  await page.getByRole("tab", { name: "Both", exact: true }).click();
  await expect(feed).toBeVisible({ timeout: 45_000 });
  await expect(story).toBeVisible();
  await page.getByRole("radio", { name: "Design", exact: true }).click();
  await expect(feed).toBeVisible();
  await expect(story).toBeVisible();
  await page.getByRole("tab", { name: "Feed", exact: true }).click();
  await page.getByRole("button", { name: "Content", exact: true }).click();
  const input = page.locator('section[aria-label="Text"] input[type="text"]').first();
  await expect(input).toBeVisible();
  const response = page.waitForResponse(res => res.url().includes("/preview?") && res.request().method() === "POST" && res.request().postData()?.includes("Canonical QA"));
  await input.fill("Canonical QA");
  const rendered = await response;
  expect(rendered.status()).toBe(200);
  expect(rendered.headers()["x-blockwise-template-hash"]).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(rendered.headers()["x-blockwise-document-hash"]).toMatch(/^[a-f0-9]{64}$/);
  await expect(feed).toBeVisible();
  expect(failures).toEqual([]);
});
