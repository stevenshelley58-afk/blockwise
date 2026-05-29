import { createClient } from "@supabase/supabase-js";

import { ApifyClient } from "./apify-client.ts";
import { loadEnv } from "./env.ts";
import { listDuePages } from "./policy.ts";
import { refreshAdvertiserPage } from "./run.ts";

async function tick(): Promise<void> {
  const env = loadEnv();
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const apify = new ApifyClient(env.APIFY_API_TOKEN, env.APIFY_DEFAULT_ACTOR);

  console.log(`[orchestrator] tick start mode=${env.ORCHESTRATOR_MODE} dry_run=${env.ORCHESTRATOR_DRY_RUN}`);

  const due = await listDuePages(supabase, env);
  console.log(`[orchestrator] ${due.length} pages due`);

  let totalCost = 0;
  // Process pages in concurrent batches.
  const concurrency = 24;
  for (let i = 0; i < due.length; i += concurrency) {
    if (totalCost > env.APIFY_DAILY_SPEND_LIMIT_USD) {
      console.warn(`[orchestrator] daily spend cap reached ($${totalCost.toFixed(2)}), stopping tick`);
      break;
    }
    const batch = due.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (page) => {
        const r = await refreshAdvertiserPage({ supabase, apify, env, page });
        console.log(
          `[orchestrator] page=${page.pageName} status=${r.status} observed=${r.observed} new=${r.inserted} upd=${r.updated} unchanged=${r.unchanged} missing=${r.missing} cost=$${r.costUsd.toFixed(4)}`,
        );
        return r.costUsd;
      }),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        totalCost += r.value;
      } else {
        console.error(`[orchestrator] page=${batch[j].pageName} ERROR: ${(r.reason as Error)?.message ?? r.reason}`);
      }
    }
  }
  console.log(`[orchestrator] tick complete total_cost=$${totalCost.toFixed(4)}`);
}

async function main() {
  const env = loadEnv();
  if (env.ORCHESTRATOR_MODE === "once") {
    await tick();
    return;
  }
  // loop mode
  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error(`[orchestrator] tick fatal: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, env.ORCHESTRATOR_LOOP_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
