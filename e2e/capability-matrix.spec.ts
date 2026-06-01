import { expect, test } from "@playwright/test";

/**
 * End-to-end proof of the capability model for the three permission surfaces.
 *
 * Asserts both layers:
 *  - UI: capability-driven nav hides surfaces a user cannot access.
 *  - Server (the real gate): operator-only APIs return 403 for clients, even
 *    with a valid session.
 *
 * Requires seeded test users (`npm run seed:test-users`) and a reachable app.
 * Set E2E_TEST_USER_PASSWORD (and NEXT_PUBLIC_APP_URL for a remote target).
 * Skips cleanly when the password is absent so it never blocks the core gate.
 */
const password = process.env.E2E_TEST_USER_PASSWORD ?? "";

const USERS = {
  operator: { email: "operator@blockwise.test", home: /\/operator/ },
  monitor: { email: "monitor@blockwise.test", home: /\/monitor/ },
  selfServe: { email: "selfserve@blockwise.test", home: /\/self-serve/ },
} as const;

test.describe("capability matrix", () => {
  test.skip(!password, "Set E2E_TEST_USER_PASSWORD and seed test users to run this suite.");

  async function login(page: import("@playwright/test").Page, email: string) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }

  test("operator can reach every surface", async ({ page }) => {
    await login(page, USERS.operator.email);
    await expect(page).toHaveURL(USERS.operator.home);
    await expect(page.getByRole("link", { name: "Operator" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Model Control" })).toBeVisible();
    await expect(page.getByRole("link", { name: "AI Workforce" })).toBeVisible();

    const res = await page.request.get("/api/model-profiles");
    expect(res.ok()).toBeTruthy();
  });

  test("monitor-only client cannot see or reach operator surfaces", async ({ page }) => {
    await login(page, USERS.monitor.email);
    await expect(page).toHaveURL(USERS.monitor.home);

    // UI: operator + authoring surfaces are hidden.
    await expect(page.getByRole("link", { name: "Model Control" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "AI Workforce" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Ad Studio" })).toHaveCount(0);

    // Server gate: operator-only control plane is forbidden even with a session.
    const res = await page.request.get("/api/model-profiles");
    expect(res.status()).toBe(403);

    // Page guard: operator-only route redirects away (does not render).
    await page.goto("/model-control");
    await expect(page).not.toHaveURL(/\/model-control/);
  });

  test("self-serve client can author but not run operator controls", async ({ page }) => {
    await login(page, USERS.selfServe.email);
    await expect(page).toHaveURL(USERS.selfServe.home);

    // UI: authoring surfaces present, operator control planes hidden.
    await expect(page.getByRole("link", { name: "Ad Studio" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Model Control" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "AI Workforce" })).toHaveCount(0);

    // Server gate: operator-only control plane is forbidden.
    const res = await page.request.get("/api/model-profiles");
    expect(res.status()).toBe(403);
  });
});
