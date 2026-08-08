import { join } from "node:path";

import { defineConfig } from "@playwright/test";

// Dedicated config for the render-parity gate (plan §4). Separate from the
// main e2e config on purpose: no auth storage-state, one fixed desktop
// project at deviceScaleFactor 1 (pixel comparison needs a known DPR), and
// its own dev-server port so it never collides with a running workspace.
//
// webServer commands resolve against the config dir (tests/render-parity/),
// so the next binary path and cwd are anchored explicitly at process.cwd() —
// the npm script always runs from the repo root.

const port = 3310;
const repoRoot = process.cwd();
const nextBin = join(repoRoot, "node_modules", "next", "dist", "bin", "next");

export default defineConfig({
  testDir: ".",
  testMatch: /parity\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
  projects: [{ name: "chromium-parity", use: { browserName: "chromium" } }],
  webServer: {
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(nextBin)} dev --hostname 127.0.0.1 --port ${port}`,
    cwd: repoRoot,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
