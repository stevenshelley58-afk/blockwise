import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
const storageState = process.env.ADSTUDIO_E2E_STORAGE_STATE ?? "/srv/blockwise/e2e-runs/mobile-app-implementation-20260908/fixture-browser-state.json";
const workspaceId = process.env.ADSTUDIO_E2E_WORKSPACE_ID;
const controlled = process.env.BLOCKWISE_CONTROLLED_CANARY === "1";
test.skip(!process.env.PLAYWRIGHT_BASE_URL || !workspaceId || !existsSync(storageState), "Requires controlled workspace fixture");
test.use({ storageState, serviceWorkers: "block", ignoreHTTPSErrors: controlled, launchOptions: {
  executablePath: process.env.ADSTUDIO_E2E_CHROMIUM,
  args: controlled ? ["--host-resolver-rules=MAP blockwise.sale 127.0.0.1,EXCLUDE localhost"] : undefined,
} });
const previewFixture = process.env.HOME_CREATIVE_PREVIEW_FIXTURE ?? '/srv/blockwise/e2e-runs/home-creative-20260908/fixture-preview.png';
for (const audience of ['first_ad', 'returning'] as const) {
  test(`${audience} shows the preview fixture with correct template targets`, async ({ page }, info) => {
    await page.addInitScript(() => localStorage.setItem('bw-consent', 'essential'));
    await page.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 409, body: 'Read-only acceptance' }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/self-serve?workspaceId=${workspaceId}`);
    expect(existsSync(previewFixture), 'Canonical renderer preview fixture must exist').toBe(true);
    await page.route('**/api/home-preview-fixture/*', route => route.fulfill({ contentType: 'image/png', path: previewFixture }));
    const safe = { creativeSuggestions: { status: 'ready', audience, items: [
      { templateId: 'qa-home-a', name: 'A fresh perspective', previewUrl: '/api/home-preview-fixture/a', href: '/ad-studio/templates/qa-home-a' },
      { templateId: 'qa-home-b', name: 'Your next conversation', previewUrl: '/api/home-preview-fixture/b', href: '/ad-studio/templates/qa-home-b' },
    ] } };
    await page.route('**/api/home-dashboard', route => route.fulfill({ status: 200, json: { ...safe, creativeSuggestions: { ...safe.creativeSuggestions, audience, status: 'ready' } } }));
    await page.reload();
    await expect(page.getByRole('heading', { name: audience === 'first_ad' ? 'Make your first ad' : 'Try a different look', exact: true })).toBeVisible();
    const preview = page.locator('img[data-template-preview]');
    await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const use = page.getByRole('link', { name: 'Use template', exact: true });
    await expect(use).toHaveAttribute('href', /^\/ad-studio\/templates\/[^/]+$/);
    const next = page.getByRole('button', { name: 'Next template', exact: true });
    if (safe.creativeSuggestions.items.length > 1) {
      const before = await use.getAttribute('href');
      await next.click();
      await expect(use).not.toHaveAttribute('href', before!);
    }
    await page.screenshot({ path: info.outputPath(`home-${audience}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Browse templates', exact: true }).click();
    await expect(page).toHaveURL(/\/ad-studio\/templates/);
    await expect(page.getByRole('main')).toBeVisible();
  });
}
for (const status of ['empty', 'exhausted', 'unavailable'] as const) {
  test(`${status} never invents a new creative or shows a broken preview`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('bw-consent', 'essential'));
    await page.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 409, body: 'Read-only acceptance' }));
    await page.route('**/api/home-dashboard', route => route.fulfill({ status: 200, json: { creativeSuggestions: { audience: status === 'exhausted' ? 'returning' : 'unknown', status, items: [] } } }));
    await page.setViewportSize({ width: 320, height: 667 });
    await page.goto(`/self-serve?workspaceId=${workspaceId}`);
    await expect(page.locator('img[data-template-preview]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Browse templates', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Use template', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-home-creative]')).not.toContainText(/Try a different look|new creative|easy template|setup steps|Workspace details/);
  });
}

test('a failed preview does not leave a broken image or duplicate actions', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bw-consent', 'essential'));
  await page.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 409, body: 'Read-only acceptance' }));
  await page.route('**/api/home-preview-fixture/broken', route => route.fulfill({ status: 404, body: 'Fixture preview unavailable' }));
  await page.route('**/api/home-dashboard', route => route.fulfill({ status: 200, json: { creativeSuggestions: { audience: 'returning', status: 'ready', items: [{ templateId: 'broken', name: 'Preview fixture', previewUrl: '/api/home-preview-fixture/broken', href: '/ad-studio/templates/broken' }] } } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/self-serve?workspaceId=${workspaceId}`);
  await expect(page.getByText('Preview unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('img[data-template-preview]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Browse templates', exact: true })).toHaveCount(1);
});
