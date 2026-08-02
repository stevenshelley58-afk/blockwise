#!/usr/bin/env node
/**
 * monid-discover.mjs — Probe Monid.ai for Meta Ad Library data endpoints.
 *
 * Tests whether Monid's tool registry has endpoints that could replace or
 * supplement the Apify actor for Meta Ad Library scraping.
 *
 * Usage:
 *   node scripts/monid-discover.mjs
 *
 * Env (optional):
 *   MONID_API_KEY — if you have a Monid account key (discover works without one).
 *
 * Output: JSON report of discovered endpoints relevant to Meta Ad Library.
 */

const MONID_API_BASE = "https://api.monid.ai/v1";

const QUERIES = [
  "meta ad library",
  "facebook ads library scraper",
  "facebook ad library data",
  "meta ads archive",
  "facebook page ads",
  "instagram ads scraper",
  "social media ad intelligence",
];

async function main() {
  const apiKey = process.env.MONID_API_KEY || "";
  const headers = {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  console.error("Probing Monid.ai discover endpoint for Meta Ad Library tools...\n");

  const allResults = [];
  const seen = new Set();

  for (const query of QUERIES) {
    console.error(`  discover: "${query}"`);
    try {
      const response = await fetch(`${MONID_API_BASE}/discover`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, limit: 10 }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.error(`    HTTP ${response.status}: ${text.slice(0, 200)}`);
        continue;
      }

      const data = await response.json();
      const tools = data.tools || data.results || data.data || [];
      if (!Array.isArray(tools)) {
        console.error(`    unexpected response shape: ${Object.keys(data).join(", ")}`);
        continue;
      }

      for (const tool of tools) {
        const id = tool.id || tool.slug || tool.name || JSON.stringify(tool).slice(0, 80);
        if (seen.has(id)) continue;
        seen.add(id);
        allResults.push({ query, ...tool });
      }
      console.error(`    found ${tools.length} result(s)`);
    } catch (error) {
      console.error(`    error: ${error?.message || error}`);
    }
  }

  // Report
  const report = {
    timestamp: new Date().toISOString(),
    queriesRun: QUERIES.length,
    uniqueToolsFound: allResults.length,
    tools: allResults,
    assessment: allResults.length === 0
      ? "No Meta Ad Library endpoints found on Monid. Their Facebook scraping may be limited to page posts/profiles, not the Ad Library."
      : `${allResults.length} potentially relevant endpoint(s) found. Review pricing and output schema before integrating.`,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`fatal: ${error?.message || error}`);
  process.exit(1);
});
