import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  budgetStatus,
  checkFailedStatus,
  checkHttpHealthTarget,
  diffForAlerts,
  formatAlert,
  levelForPct,
  parseVpsHealthTargets,
  toState,
  type ServiceStatus,
} from "../src/lib/alerts/paid-service-watchdog.ts";
import { verifyVercelSignature } from "../src/lib/alerts/vercel-webhook.ts";
import { createHmac } from "node:crypto";

test("levelForPct thresholds: warn at 80, critical at 95", () => {
  assert.equal(levelForPct(0), "ok");
  assert.equal(levelForPct(79.9), "ok");
  assert.equal(levelForPct(80), "warn");
  assert.equal(levelForPct(94.9), "warn");
  assert.equal(levelForPct(95), "critical");
  assert.equal(levelForPct(120), "critical");
});

test("budgetStatus reports usage against budget", () => {
  const status = budgetStatus("openai-spend", "Provider month-to-date", 42, 50);
  assert.equal(status.level, "warn");
  assert.equal(Math.round(status.pctUsed ?? 0), 84);
  assert.match(status.summary, /\$42\.00 of \$50\.00/);
});

test("budgetStatus with no budget configured stays ok", () => {
  const status = budgetStatus("openai-spend", "Provider month-to-date", 42, 0);
  assert.equal(status.level, "ok");
  assert.equal(status.pctUsed, null);
});

test("a failed check is critical so outages are never silent", () => {
  const status = checkFailedStatus("openai-api", "OpenAI", "HTTP 500");
  assert.equal(status.level, "critical");
  assert.match(status.summary, /check failed/);
});

test("diffForAlerts alerts on escalation only, not on steady state", () => {
  const warn: ServiceStatus = { service: "a", level: "warn", summary: "a warn", pctUsed: 85 };
  // ok -> warn escalates
  assert.equal(diffForAlerts({}, [warn]).escalations.length, 1);
  // warn -> warn stays silent
  const steady = diffForAlerts({ a: "warn" }, [warn]);
  assert.equal(steady.escalations.length, 0);
  assert.equal(steady.recoveries.length, 0);
  // warn -> critical escalates again
  const critical: ServiceStatus = { ...warn, level: "critical" };
  assert.equal(diffForAlerts({ a: "warn" }, [critical]).escalations.length, 1);
});

test("diffForAlerts sends recovery when a service returns to ok", () => {
  const ok: ServiceStatus = { service: "a", level: "ok", summary: "a ok", pctUsed: 10 };
  const diff = diffForAlerts({ a: "critical" }, [ok]);
  assert.equal(diff.escalations.length, 0);
  assert.equal(diff.recoveries.length, 1);
});

test("toState maps service to level for persistence", () => {
  const state = toState([
    { service: "a", level: "warn", summary: "", pctUsed: null },
    { service: "b", level: "ok", summary: "", pctUsed: null },
  ]);
  assert.deepEqual(state, { a: "warn", b: "ok" });
});

test("formatAlert subject carries the worst escalated level", () => {
  const statuses: ServiceStatus[] = [
    { service: "openai-api", level: "critical", summary: "OpenAI: unavailable", pctUsed: 99 },
    { service: "openai-spend", level: "warn", summary: "Provider: 84%", pctUsed: 84 },
  ];
  const { subject, text } = formatAlert({ escalations: statuses, recoveries: [] }, statuses);
  assert.match(subject, /CRITICAL/);
  assert.match(subject, /openai-api/);
  assert.match(text, /Full picture/);
});

test("verifyVercelSignature accepts a valid HMAC and rejects others", () => {
  const secret = "shhh";
  const body = JSON.stringify({ thresholdPercent: 75 });
  const good = createHmac("sha1", secret).update(body).digest("hex");
  assert.equal(verifyVercelSignature(body, good, secret), true);
  assert.equal(verifyVercelSignature(body, "deadbeef", secret), false);
  assert.equal(verifyVercelSignature(body, null, secret), false);
});

test("parseVpsHealthTargets supports labelled VPS and Hermes endpoints", () => {
  const targets = parseVpsHealthTargets("Hermes VPS|https://hermes.example/health,https://browser.example/health");
  assert.deepEqual(targets, [
    { service: "vps-health-hermes-vps", label: "Hermes VPS", url: "https://hermes.example/health" },
    { service: "vps-health-vps-health-2", label: "VPS health 2", url: "https://browser.example/health" },
  ]);
});

test("checkHttpHealthTarget reports reachable, unhealthy, and invalid VPS endpoints", async () => {
  const ok = await checkHttpHealthTarget(
    { service: "vps-health-hermes", label: "Hermes VPS", url: "https://hermes.example/health" },
    async () => new Response("ok", { status: 200 }),
  );
  assert.equal(ok.level, "ok");
  assert.match(ok.summary, /HTTP 200/);

  const down = await checkHttpHealthTarget(
    { service: "vps-health-hermes", label: "Hermes VPS", url: "https://hermes.example/health" },
    async () => new Response("down", { status: 503 }),
  );
  assert.equal(down.level, "critical");

  const invalid = await checkHttpHealthTarget({
    service: "vps-health-hermes",
    label: "Hermes VPS",
    url: "file:///etc/passwd",
  });
  assert.equal(invalid.level, "critical");
});

test("paid-service watchdog is scheduled on Vercel and guarded by CRON_SECRET", () => {
  const vercelConfig = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };
  const route = readFileSync("src/app/api/alerts/paid-service-watchdog/route.ts", "utf8");

  assert.deepEqual(vercelConfig.crons?.find((cron) => cron.path === "/api/alerts/paid-service-watchdog"), {
    path: "/api/alerts/paid-service-watchdog",
    schedule: "0 */2 * * *",
  });
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /authorization !== `Bearer \$\{secret\}`/);
});

test("Vercel watchdog observes Hermes paid-capture state instead of running Apify", () => {
  const watchdog = readFileSync("src/lib/alerts/paid-service-watchdog.ts", "utf8");
  const route = readFileSync("src/app/api/alerts/paid-service-watchdog/route.ts", "utf8");
  const appSideWatchdog = `${watchdog}\n${route}`;

  assert.match(watchdog, /research\.from\("v_health"\)\.select\("apify_mtd_spend_usd,apify_state"\)/);
  assert.doesNotMatch(appSideWatchdog, /APIFY_(?:API_)?TOKEN/u);
  assert.doesNotMatch(appSideWatchdog, /api\.apify\.com/u);
  assert.doesNotMatch(appSideWatchdog, /\b(?:createApifyRun|runApifyCapture|fetchApifyDatasetItems)\b/u);
  assert.doesNotMatch(appSideWatchdog, /\b(?:ensureApifyAccountLimit|guardApifyBudget)\b/u);
});
