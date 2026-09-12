#!/usr/bin/env node
/**
 * Edge-caches the prerendered marketing HTML at Cloudflare.
 *
 * Why this is a script: the change lives in the Cloudflare zone, not in this
 * repository, so it cannot ride the release. It is idempotent, it verifies
 * itself, and it records the reasoning that a dashboard click would lose.
 *
 * Why a day and not the origin's `s-maxage=31536000`: the prerendered HTML names
 * release-specific `/_next/static/chunks/*` files and a release serves them from a
 * fresh checkout, so the previous hashes stop existing the moment a release
 * lands. `scripts/vps/product-edge-purge.sh` clears these URLs on every release,
 * which is what makes a long TTL safe; a day is the backstop for the case where
 * that purge fails, so the damage heals by itself within a day instead of a year.
 * A short TTL was the earlier compromise and it cost nearly every hit on a site
 * whose traffic is spread out.
 *
 * The expression does not exclude requests that carry a session cookie. All five
 * pages are prerendered per release and hold nothing visitor-specific, so a
 * signed-in visitor is served the same bytes either way, and the clause would
 * only cost hit rate. Add `and not http.cookie contains "sb-"` before shipping a
 * personalised page under one of these paths; the deployed rule was verified
 * with a session cookie present and answers HIT, which confirms this shape.
 *
 * `browser_ttl` is `respect_origin`, not `bypass`. `bypass` was the first choice,
 * but Cloudflare implements it by appending `no-store` to the origin's
 * Cache-Control (measured: origin answers `s-maxage=31536000`, the edge answers
 * `s-maxage=31536000, no-store`), and a `no-store` document is ineligible for the
 * back/forward cache, so every back navigation re-rendered. `respect_origin`
 * forwards the origin header untouched: the prerendered HTML carries
 * `s-maxage=31536000` and no `max-age` and no `Last-Modified`, so a private cache
 * has no freshness to apply, ignores the shared-cache-only `s-maxage`, and
 * revalidates with the ETag on every navigation. The browser still never holds
 * the markup, which is the property this rule needs, and the ETag revalidation
 * is answered from the edge.
 *
 * Usage (the token needs Zone -> Cache Rules -> Edit on the zone):
 *   CLOUDFLARE_API_TOKEN=... node scripts/vps/cloudflare-edge-cache.mjs apply [--dry-run]
 *   node scripts/vps/cloudflare-edge-cache.mjs check
 */

const ZONE_NAME = process.env.CLOUDFLARE_ZONE_NAME ?? "blockwise.sale";
const API = "https://api.cloudflare.com/client/v4";
// Must match the rule's name in the dashboard exactly: the tool merges by
// description, and a mismatch appends a second, overlapping rule instead.
const RULE_DESCRIPTION = "marketing html";

/** Prerendered public pages. Each one is identical for every visitor. */
const CACHED_PATHS = ["/", "/pricing", "/privacy", "/terms", "/data-deletion"];

const EDGE_TTL_SECONDS = 86_400;

const requiredPermission = "Zone -> Cache Rules -> Edit (zone: " + ZONE_NAME + ")";

function token() {
  const value = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!value) {
    process.stderr.write(`CLOUDFLARE_API_TOKEN is not set. It needs ${requiredPermission}.\n`);
    process.exit(2);
  }
  return value;
}

async function call(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (body.success === false) {
    const message = (body.errors ?? []).map((error) => error.message).join("; ") || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body.result;
}

async function zoneId() {
  const zones = await call(`/zones?name=${encodeURIComponent(ZONE_NAME)}`);
  const zone = zones?.[0];
  if (!zone) throw new Error(`No zone named ${ZONE_NAME} is visible to this token.`);
  return zone.id;
}

function rule() {
  return {
    description: RULE_DESCRIPTION,
    enabled: true,
    expression: `(http.request.uri.path in {${CACHED_PATHS.map((path) => `"${path}"`).join(" ")}})`,
    action: "set_cache_settings",
    action_parameters: {
      cache: true,
      edge_ttl: { mode: "override_origin", default: EDGE_TTL_SECONDS },
      browser_ttl: { mode: "respect_origin" },
    },
  };
}

async function readEntrypoint(zone) {
  try {
    return await call(`/zones/${zone}/rulesets/phases/http_request_cache_settings/entrypoint`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function apply({ dryRun }) {
  const zone = await zoneId();

  // A dry run must work with no ruleset permission at all, so the payload can be
  // reviewed before anyone is asked for a wider token.
  let existing = null;
  try {
    existing = await readEntrypoint(zone);
  } catch (error) {
    if (!dryRun) throw error;
  }
  const others = existing === null
    ? []
    : (existing.rules ?? []).filter((entry) => entry.description !== RULE_DESCRIPTION);
  const rules = [...others, rule()];

  process.stdout.write(`zone ${zone}\nexpression ${rule().expression}\nedge ttl ${EDGE_TTL_SECONDS}s, browser ttl bypassed\n`);
  process.stdout.write(
    existing === null
      ? "could not read the existing ruleset (token lacks ruleset access), so the merge list is unknown\n"
      : `keeps ${others.length} existing cache rule(s), writes ${rules.length}\n`,
  );
  if (dryRun) {
    process.stdout.write(JSON.stringify({ rules }, null, 2) + "\n");
    return;
  }

  await call(`/zones/${zone}/rulesets/phases/http_request_cache_settings/entrypoint`, {
    method: "PUT",
    body: JSON.stringify({ rules }),
  });
  process.stdout.write("applied. Run `check` after the first request warms the edge.\n");
}

async function check() {
  let failures = 0;
  for (const path of CACHED_PATHS) {
    const first = await probe(path);
    const second = await probe(path);
    const cached = second.status === "HIT" || second.status === "REVALIDATED";
    if (!cached) failures += 1;
    process.stdout.write(
      `${path.padEnd(16)} first=${String(first.status).padEnd(9)} second=${String(second.status).padEnd(9)} ttfb ${first.ttfbMs}ms -> ${second.ttfbMs}ms\n`,
    );
  }
  if (failures > 0) {
    process.stderr.write(
      `${failures} path(s) are not edge-cached. Apply the rule (needs ${requiredPermission}), then re-run.\n`,
    );
    process.exit(1);
  }
}

async function probe(path) {
  const started = Date.now();
  // No `Cache-Control: no-cache` here on purpose: Cloudflare honours that request
  // directive by going to the origin and not storing the response, which would
  // make the second request a MISS forever and hide a working rule.
  const response = await fetch(`https://${ZONE_NAME}${path}`, {
    headers: { "User-Agent": "blockwise-edge-cache-check" },
  });
  await response.arrayBuffer();
  return { status: response.headers.get("cf-cache-status"), ttfbMs: Date.now() - started };
}

const [command, ...flags] = process.argv.slice(2);
try {
  if (command === "apply") await apply({ dryRun: flags.includes("--dry-run") });
  else if (command === "check") await check();
  else {
    process.stderr.write("Usage: cloudflare-edge-cache.mjs apply [--dry-run] | check\n");
    process.exit(2);
  }
} catch (error) {
  process.stderr.write(`cloudflare: ${error.message}\n`);
  if (/authentication error|unauthorized/i.test(error.message)) {
    process.stderr.write(`This token cannot write rulesets. It needs ${requiredPermission}.\n`);
    process.exit(2);
  }
  process.exit(1);
}
