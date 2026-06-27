import { defineConfig } from "@trigger.dev/sdk/v3";
import { captureTriggerException, initTriggerSentry } from "./trigger/sentry";

export default defineConfig({
  project: "configured-by-trigger-cli-project-ref",
  dirs: ["./trigger"],
  maxDuration: 300,
  init: async () => {
    initTriggerSentry();
  },
  onFailure: async ({ error, task }) => {
    captureTriggerException(error, task);
  },
  build: {
    external: ["playwright", "playwright-core", "chromium-bidi"],
  },
});
