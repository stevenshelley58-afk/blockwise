import { defineConfig } from "@trigger.dev/sdk/v3";
import { captureTriggerException, initTriggerSentry } from "./trigger/sentry";

export default defineConfig({
  // The trigger.dev project ref (proj_...) comes from the environment — the
  // committed value was a placeholder, which is one of the reasons the async
  // lane never worked. Set TRIGGER_PROJECT_ID locally and in CI to deploy.
  project: process.env.TRIGGER_PROJECT_ID ?? "configured-by-trigger-cli-project-ref",
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
