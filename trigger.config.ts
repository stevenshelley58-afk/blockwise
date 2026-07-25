import { defineConfig } from "@trigger.dev/sdk/v3";
import { captureTriggerException, initTriggerSentry } from "./trigger/sentry";

// Touched 2026-07-25 to redeploy the tasks with the gpt-5.x reasoning_effort
// fix (src/lib/adstudio/ai-providers.ts) bundled — the deploy workflow's
// paths filter only watches trigger/** and this file.
export default defineConfig({
  // Deliberately a placeholder: the real project ref is supplied at deploy
  // time (see .github/workflows/trigger-deploy.yml, --project-ref) so no
  // environment identifier is committed. Enforced by observability-config test.
  project: "configured-by-trigger-cli-project-ref",
  dirs: ["./trigger"],
  maxDuration: 900,
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
