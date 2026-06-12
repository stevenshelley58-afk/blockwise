import { defineConfig } from "@trigger.dev/sdk/v3";
import { captureTriggerException, initTriggerSentry } from "./trigger/sentry";

function requireTriggerProjectId() {
  const projectId = process.env.TRIGGER_PROJECT_ID?.trim() ?? process.env.TRIGGER_PROJECT_REF?.trim();

  if (!projectId) {
    throw new Error("TRIGGER_PROJECT_ID or TRIGGER_PROJECT_REF is required to deploy or run Trigger.dev tasks.");
  }

  return projectId;
}

export default defineConfig({
  project: requireTriggerProjectId(),
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
