#!/usr/bin/env node

// Prevent dynamic filesystem reads from silently packaging the repository into
// Vercel functions. Sizes are uncompressed traced bytes; 180 MB leaves a
// meaningful margin below the platform's 250 MB uncompressed ceiling.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const root = process.cwd();
const MAX_TRACED_BYTES = 180 * 1024 * 1024;
const traceRoot = resolve(root, ".next", "server", "app");
const requiredRoutes = [
  ".next/server/app/(customer)/ad-studio/page.js.nft.json",
  ".next/server/app/(operator)/operator/template-studio/page.js.nft.json",
  ".next/server/app/api/adstudio/campaigns/route.js.nft.json",
  ".next/server/app/api/adstudio/creatives/[id]/doc/route.js.nft.json",
  ".next/server/app/api/adstudio/templates-v2/[id]/route.js.nft.json",
  ".next/server/app/api/operator/template-studio/[id]/route.js.nft.json",
  ".next/server/app/api/operator/template-studio/source/route.js.nft.json",
  ".next/server/app/api/operator/template-trace/[id]/regenerate/route.js.nft.json",
  ".next/server/app/api/operator/template-trace/[id]/source-image/route.js.nft.json",
];
const regenerateRoute = ".next/server/app/api/operator/template-trace/[id]/regenerate/route.js.nft.json";

function discoverProductTraces(directory) {
  if (!existsSync(directory)) return [];
  const traces = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      traces.push(...discoverProductTraces(path));
      continue;
    }
    if (!entry.name.endsWith(".nft.json")) continue;
    const repoPath = relative(root, path).split(sep).join("/");
    if (
      repoPath.includes("/api/adstudio/")
      || repoPath.includes("/(customer)/ad-studio/")
      || repoPath.includes("/(operator)/operator/template-studio/")
      || repoPath.includes("/(operator)/operator/template-trace/")
      || repoPath.includes("/api/operator/template-studio/")
      || repoPath.includes("/api/operator/template-trace/")
    ) {
      traces.push(repoPath);
    }
  }
  return traces;
}

const routes = discoverProductTraces(traceRoot).sort();

let failed = false;
if (routes.length === 0) {
  console.error("adstudio-function-traces: no production traces found; run next build first");
  failed = true;
}
for (const tracePath of requiredRoutes) {
  if (!routes.includes(tracePath)) {
    console.error(`adstudio-function-traces: missing required ${tracePath}`);
    failed = true;
  }
}

for (const tracePath of routes) {
  const trace = JSON.parse(readFileSync(tracePath, "utf8"));
  const traceDir = dirname(resolve(tracePath));
  const files = [...new Set(trace.files.map((file) => resolve(traceDir, file)))];
  const bytes = files.reduce((sum, file) => sum + (existsSync(file) ? statSync(file).size : 0), 0);
  const sizeMb = bytes / 1024 / 1024;
  if (bytes > MAX_TRACED_BYTES) {
    console.error(`adstudio-function-traces: ${tracePath} is ${sizeMb.toFixed(1)} MB (limit 180 MB)`);
    failed = true;
  }

  const customerRoute = tracePath.includes("/(customer)/ad-studio/")
    || tracePath.includes("/api/adstudio/");
  const metadataOnlyCustomerRoute = tracePath.endsWith("/(customer)/ad-studio/page.js.nft.json")
    || tracePath.endsWith("/api/adstudio/templates-v2/[id]/route.js.nft.json");
  if (customerRoute || tracePath === regenerateRoute) {
    const forbidden = files
      .map((file) => relative(root, file))
      .filter((file) => (
        file === "meta_ad_candidates"
        || file.startsWith(`meta_ad_candidates${sep}`)
        || (metadataOnlyCustomerRoute && (
          file === `src${sep}lib${sep}adstudio${sep}template-assets-v2`
          || file.startsWith(`src${sep}lib${sep}adstudio${sep}template-assets-v2${sep}`)
        ))
        || (tracePath === regenerateRoute
          ? file === "public" || file.startsWith(`public${sep}`)
          : file === `public${sep}adstudio-samples`
            || file.startsWith(`public${sep}adstudio-samples${sep}`))
      ));
    if (forbidden.length > 0) {
      console.error(`adstudio-function-traces: route contains private/research or bundled public material: ${forbidden[0]}`);
      failed = true;
    }
  }
  console.log(`adstudio-function-traces: ${tracePath} ${sizeMb.toFixed(1)} MB`);
}

console.log(`adstudio-function-traces: checked ${routes.length} product traces`);
if (failed) process.exit(1);
