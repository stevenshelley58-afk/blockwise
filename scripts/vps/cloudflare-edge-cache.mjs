#!/usr/bin/env node
/**
 * Edge-caches the prerendered marketing HTML at Cloudflare.
 *
 * Why this is a script: the change lives in the Cloudflare zone, not in this
 * repository, so it cannot ride the release. It is idempotent, it verifies
 * itself, and it records the reasoning that a dashboard click would lose.
 *
 * Why the TTL is 300 seconds and not the origin's `s-maxage=31536000`: the
 * prerendered HTML names release-specific `/_next/static/chunks/*` files, and a
 * release serves them from a fresh immutable checkout, so the previous hashes
 * stop existing the moment a release lands. Caching HTML for a year would serve
 * markup whose scripts 404. A short edge TTL bounds the damage to one window
 * after a release; a `Cache Purge` token in `product-release.sh` is the way to
 * raise it, which is deliberately not wired here.
 *
 * The rule also refuses to cache a request that carries a session cookie, so a
 * signed-in visitor can never be handed another visitor's HTML. These five pages
 * are prerendered and identical for everyone today, so the clause costs almost no
 * hit rate (they are prospect pages, mostly fetched anonymously) and it survives
 * someone personalising one of them later.
 *
 * `browser_ttl` stays `respect_origin` on purpose: the origin sends `s-maxage`
 * only, which a browser ignores, so a visitor revalidates their copy while the
 * edge still answers it. Extending browser caching would be the one way a client
 * could hold markup whose chunk URLs no longer exist.
 *
 * Usage (the token needs Zone -> Cache Rules -> Edit on the zone):
 *   CLOUDFLARE_API_TOKEN=... node scripts/vps/cloudflare-edge-cache.mjs apply [--dry-run]
 *   node scripts/vps/cloudflare-edge-cache.mjs check
 */

const ZONE_NAME = process.env.CLOUDFLARE_ZONE_NAME ?? "blockwise.sale";
const API = "https://api.cloudflare.com/client/v4";
const RULE_DESCRIPTION = "blockwise: edge cache prerendered marketing HTML";

/** Prerendered public pages. Each one is identical for every visitor. */
const CACHED_PATHS = ["/", "/pricing", "/privacy", "/terms", "/data-deletion"];

const EDGE_TTL_SECONDS = 300;

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
    expression: [
      `(http.request.method eq "GET"`,
      ` and http.request.uri.path in {${CACHED_PATHS.map((path) => `"${path}"`).join(" ")}}`,
      ` and not http.cookie contains "sb-")`,
    ].join(""),
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

  process.stdout.write(`zone ${zone}\nexpression ${rule().expression}\nedge ttl ${EDGE_TTL_SECONDS}s, browser ttl respects the origin\n`);
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
  const response = await fetch(`https://${ZONE_NAME}${path}`, {
    headers: { "Cache-Control": "no-cache", "User-Agent": "blockwise-edge-cache-check" },
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
