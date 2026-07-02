import { defineConfig } from "@trigger.dev/sdk/v3";
import { captureTriggerException, initTriggerSentry } from "./trigger/sentry";

export default defineConfig({
  // Deliberately a placeholder: the real project ref is supplied at deploy
  // time (see .github/workflows/trigger-deploy.yml, --project-ref) so no
  // environment identifier is committed. Enforced by observability-config test.
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
