import { defineConfig, devices } from "@playwright/test";

const port = process.env.PORT ?? "3000";
const localBaseUrl = `http://127.0.0.1:${port}`;
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
const nodeExecutable = JSON.stringify(process.execPath);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: externalBaseUrl ?? localBaseUrl,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `${nodeExecutable} node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`,
        url: localBaseUrl,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
