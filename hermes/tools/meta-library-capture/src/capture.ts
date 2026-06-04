import { loadMetaCaptureConfig, type MetaCaptureConfig } from "./config.ts";
import {
  DisabledMetaCaptureClient,
  HttpJsonMetaCaptureClient,
  type MetaProviderClient,
} from "./clients.ts";
import { type MetaCaptureInput, type MetaCaptureOutcome, validateMetaCaptureInput } from "./types.ts";

export type MetaLibraryCaptureTool = {
  provider: MetaCaptureConfig["HERMES_META_CAPTURE_PROVIDER"];
  captureResolvedPage(input: MetaCaptureInput | unknown): Promise<MetaCaptureOutcome>;
};

export function createMetaLibraryCaptureTool(config: MetaCaptureConfig = loadMetaCaptureConfig()): MetaLibraryCaptureTool {
  const client = createClient(config);
  return {
    provider: config.HERMES_META_CAPTURE_PROVIDER,
    captureResolvedPage: (input) => client.run(validateMetaCaptureInput(input)),
  };
}

function createClient(config: MetaCaptureConfig): MetaProviderClient {
  switch (config.HERMES_META_CAPTURE_PROVIDER) {
    case "http_json":
      if (!config.HERMES_META_CAPTURE_ENDPOINT) {
        throw new Error("HERMES_META_CAPTURE_ENDPOINT is required when HERMES_META_CAPTURE_PROVIDER=http_json");
      }
      return new HttpJsonMetaCaptureClient({
        endpoint: config.HERMES_META_CAPTURE_ENDPOINT,
        timeoutMs: config.HERMES_META_CAPTURE_TIMEOUT_MS,
        estimatedCostUsd: config.HERMES_META_CAPTURE_ESTIMATED_COST_USD,
        provider: config.HERMES_META_CAPTURE_PROVIDER,
      });
    case "disabled":
    default:
      return new DisabledMetaCaptureClient();
  }
}
