import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createAdCollectionProvider } from "./ad-provider.ts";
import { loadEnv } from "./env.ts";
import { listDuePages } from "./policy.ts";
import { refreshAdvertiserPage } from "./run.ts";

async function tick(): Promise<void> {
  const env = loadEnv();
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const provider = createAdCollectionProvider(env);
  const estimatedRunCostUsd = estimateRunCostUsd(provider.sourceProvider, env);
  const spendLimitUsd = env.AD_COLLECTOR_DAILY_SPEND_LIMIT_USD;

  console.log(`[orchestrator] tick start mode=${env.ORCHESTRATOR_MODE} provider=${provider.name} dry_run=${env.ORCHESTRATOR_DRY_RUN}`);

  const due = await listDuePages(supabase, env);
  console.log(`[orchestrator] ${due.length} pages due`);

  let totalCost = await loadSpendLast24hUsd(supabase, provider.sourceProvider);
  console.log(`[orchestrator] spend_24h=$${totalCost.toFixed(4)} cap=$${spendLimitUsd.toFixed(2)} estimated_run=$${estimatedRunCostUsd.toFixed(4)}`);

  for (const page of due) {
    const projectedCost = totalCost + estimatedRunCostUsd;
    if (spendLimitUsd <= 0 && estimatedRunCostUsd > 0) {
      console.warn("[orchestrator] paid provider configured but daily spend cap is zero, stopping tick");
      break;
    }
    if (spendLimitUsd > 0 && projectedCost > spendLimitUsd) {
      console.warn(`[orchestrator] daily spend cap reached ($${totalCost.toFixed(2)} / $${spendLimitUsd.toFixed(2)}), stopping tick`);
      break;
    }
    try {
      const r = await refreshAdvertiserPage({ supabase, provider, env, page });
      totalCost += r.costUsd;
      console.log(
        `[orchestrator] page=${page.pageName} status=${r.status} observed=${r.observed} new=${r.inserted} upd=${r.updated} unchanged=${r.unchanged} missing=${r.missing} cost=$${r.costUsd.toFixed(4)}`,
      );
    } catch (err) {
      console.error(`[orchestrator] page=${page.pageName} ERROR: ${(err as Error).message}`);
    }
  }
  console.log(`[orchestrator] tick complete total_cost=$${totalCost.toFixed(4)}`);
}

async function loadSpendLast24hUsd(supabase: SupabaseClient, sourceProvider: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .schema("research")
    .from("ad_fetch_runs")
    .select("cost_usd")
    .eq("source_provider", sourceProvider)
    .gte("started_at", since);
  if (error) throw error;
  return (data ?? []).reduce((sum, row: { cost_usd: number | string | null }) => sum + (Number(row.cost_usd) || 0), 0);
}

function estimateRunCostUsd(sourceProvider: string, env: ReturnType<typeof loadEnv>): number {
  if (sourceProvider === "searchapi_meta") return env.SEARCHAPI_ESTIMATED_COST_PER_RUN_USD;
  return 0;
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
