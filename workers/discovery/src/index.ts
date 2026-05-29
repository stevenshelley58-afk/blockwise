import { createClient } from "@supabase/supabase-js";

import { runDiscoveryCycle } from "./discover.ts";
import { queries } from "./queries.ts";

const env = {
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  APIFY_API_TOKEN: process.env.APIFY_API_TOKEN!,
  DISCOVERY_INTERVAL_HOURS: parseInt(process.env.DISCOVERY_INTERVAL_HOURS ?? "6", 10),
  DISCOVERY_DRY_RUN: process.env.DISCOVERY_DRY_RUN === "true",
};

for (const [k, v] of Object.entries(env)) {
  if (typeof v === "string" && !v) {
    console.error(`Missing env: ${k}`);
    process.exit(1);
  }
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function cycle() {
  if (env.DISCOVERY_DRY_RUN) {
    console.log("[discovery] DRY RUN; skipping cycle");
    return;
  }
  try {
    const start = Date.now();
    const result = await runDiscoveryCycle(supabase, queries, env.APIFY_API_TOKEN);
    const dur = ((Date.now() - start) / 1000).toFixed(0);
    console.log(
      `[discovery] cycle complete in ${dur}s — searches=${result.totalSearches} unique=${result.uniquePages} new=${result.newPages} errors=${result.errors}`,
    );
  } catch (err) {
    console.error(`[discovery] cycle failed: ${(err as Error).message}`);
  }
}

async function main() {
  console.log(`[discovery] starting; interval=${env.DISCOVERY_INTERVAL_HOURS}h`);
  await cycle();
  setInterval(cycle, env.DISCOVERY_INTERVAL_HOURS * 3600 * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
