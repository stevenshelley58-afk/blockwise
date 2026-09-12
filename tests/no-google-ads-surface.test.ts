import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Google Ads was parked for the Meta-only launch and then removed. These
// checks fail if the integration, its copy, its configuration or its demo data
// comes back. Google identities that are not advertising stay allowed: Google
// sign-in, Google Places address autocomplete, and the Google AI Studio image
// provider, so the scan looks for ad-specific tokens rather than "google".
const AD_SURFACE_ROOTS = ["src", "worker", "e2e", "infra", "docs"];
const AD_SURFACE_FILES = [".env.example", "next.config.ts", "supabase/seed.sql"];
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".md", ".yml", ".yaml", ".sql", ".example"];

// Apply the verbatim token set everywhere on the ad surface.
const AD_TOKENS = [
  /GOOGLE_ADS/i,
  /googleAds/i,
  /google ads/i,
  /google-ads/i,
  /adwords/i,
  /integrations\/google\b/i,
  /googleadservices/i,
];

// The shapes a reintroduced ad-provider integration needs. These are
// provider-qualified, so Google sign-in, Google Places and the Gemini image
// provider (which all legitimately carry a "google" value) stay clean.
// The AI and sign-in surfaces carry a "google" provider of their own (Gemini
// image generation and Google Identity), so they are out of this scan's scope.
const AI_OR_SIGN_IN_PATHS = [
  "src/lib/ai",
  "src/lib/adstudio",
  "src/app/api/adstudio",
  "src/components/auth",
  "src/components/model-control-panel.tsx",
];

const AD_PROVIDER_PATTERNS = [
  /provider:\s*["']google["']/i,
  /\.eq\(\s*["']provider["']\s*,\s*["']google["']/i,
  /provider[\s"':=]+["']google["']\s*[,)]/i,
];

function collectFiles(dir: string): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;

    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      results.push(...collectFiles(path));
      continue;
    }

    if (SCANNED_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
      results.push(path);
    }
  }

  return results;
}

test("no Google Ads integration code, copy, config or demo data remains", () => {
  const offenders: string[] = [];
  const files = [
    ...AD_SURFACE_ROOTS.flatMap(collectFiles),
    ...AD_SURFACE_FILES.filter((file) => existsSync(file)),
  ];

  for (const file of files) {
    if (AI_OR_SIGN_IN_PATHS.some((prefix) => file.startsWith(prefix))) continue;

    const source = readFileSync(file, "utf8");

    for (const pattern of [...AD_TOKENS, ...AD_PROVIDER_PATTERNS]) {
      const match = source.match(pattern);
      if (match) offenders.push(`${file}: ${match[0]}`);
    }
  }

  assert.deepEqual(offenders, []);
});
