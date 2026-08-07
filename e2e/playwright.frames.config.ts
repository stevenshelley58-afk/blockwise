import { join } from "node:path";

import { defineConfig } from "@playwright/test";

// Dedicated config for the Meta-frames visual baselines (§14). Own dev server
// on 3311 so it never collides with the parity gate (3310) or a workspace.
// Snapshots are update-on-purpose: run --update-snapshots only when Meta's
// chrome or the frames are deliberately redesigned, and review the diff.

const port = 3311;
const repoRoot = process.cwd();
const nextBin = join(repoRoot, "node_modules", "next", "dist", "bin", "next");

export default defineConfig({
  testDir: ".",
  testMatch: /meta-frames\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
  projects: [{ name: "chromium-frames", use: { browserName: "chromium" } }],
  webServer: {
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(nextBin)} dev --hostname 127.0.0.1 --port ${port}`,
    cwd: repoRoot,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
