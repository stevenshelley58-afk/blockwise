import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID ?? "proj_blockwise_local",
  dirs: ["./trigger"],
  maxDuration: 300,
  build: {
    external: ["playwright", "playwright-core", "chromium-bidi"],
  },
});
