const root = new URL("../../hermes/tools/research-runtime/bin/", import.meta.url);
await Promise.all([
  "ad-classifier.mjs", "content-engine.mjs", "ad-radar-accuracy-audit.mjs",
  "ad-radar-runtime-gate.mjs", "ad-radar-apify-adapter.mjs",
  "runtime-provider-token.mjs", "ad-radar-media.mjs", "meta-ad-library-parser.mjs",
  "scrapingbee-paid-attempt.mjs", "customer-read-model-publisher.mjs", "inactive-ad-purge.mjs",
  "supabase-credentials.mjs",
].map((name) => import(new URL(name, root))));

const sharp = (await import("sharp")).default;
if (!sharp.versions?.vips) throw new Error("sharp native image runtime unavailable");
