import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("Stalwart foundation is pinned, isolated and mail-only at the host", async () => {
  const compose = await read("infra/coolify/docker-compose.product.yml");
  const service = compose.slice(compose.indexOf("  product-mail:"), compose.indexOf("  product-auth:"));
  assert.match(service, /image: stalwartlabs\/stalwart:v0\.16\.18@sha256:0df5900cab389a8ec47b7521ef0681ec93598caf72a09097685845211861f6c2/);
  assert.match(service, /profiles: \[mail\]/);
  assert.match(service, /read_only: true/);
  assert.match(service, /no-new-privileges:true/);
  assert.match(service, /healthz\/ready/);
  assert.match(service, /:25"/);
  assert.match(service, /:587"/);
  assert.doesNotMatch(service, /:8080:|:143:|:993:|:4190:/);
  assert.match(compose, /GOTRUE_SMTP_HOST: \$\{BLOCKWISE_AUTH_SMTP_HOST:-product-mail\}/);
});

test("mail validation and acceptance default are fail-closed", async () => {
  const validation = await read("scripts/vps/mail-validate.sh");
  assert.match(validation, /BLOCKWISE_MAIL_ENABLED/);
  assert.match(validation, /EMAIL_PROVIDER must be smtp/);
  assert.match(validation, /Resend is compatibility-only/);
  assert.match(await read("scripts/vps/product-health.sh"), /must be true for production readiness/);
  const backup = await read("scripts/vps/stalwart-backup.sh");
  assert.match(backup, /mail backup blocked/);
  assert.match(backup, /status=running/);
  assert.match(backup, /alpine:3\.22\.1@sha256:eafc1edb577d2e9b458664a15f23ea1c370214193226069eb22921169fc7e43f/);
  const acceptance = await read("scripts/vps/gotrue-mail-acceptance.mjs");
  assert.match(acceptance, /BLOCKWISE_ACCEPTANCE_APPLY=true/);
  assert.match(acceptance, /localhost, Vercel or managed Supabase/);
  assert.match(acceptance, /\/user/);
  assert.match(acceptance, /replayRejected/);
  assert.match(acceptance, /fetchTextBodyValues: true/);
  assert.match(acceptance, /fetchHTMLBodyValues: true/);
  assert.match(acceptance, /message\.to/);
  assert.match(acceptance, /throw new AcceptanceFailure/);
  assert.match(acceptance, /flow === "signup" \? \["BLOCKWISE_ACCEPTANCE_PASSWORD"\]/);
  assert.match(acceptance, /replace\(\/&amp;\/gu, "&"\)/);
  assert.match(acceptance, /endsWith\("\.supabase\.co"\)/);
  assert.match(acceptance, /redirected\.origin !== siteUrl\.origin/);
  const output = execFileSync("node", ["scripts/vps/gotrue-mail-acceptance.mjs"], { cwd: root, encoding: "utf8" });
  assert.match(output, /"status":"preflight"/);
});

test("Stalwart webhook adapter is signed, shared, and narrow", async () => {
  const adapter = await read("src/app/api/internal/email/stalwart/route.ts");
  const shared = await read("src/lib/email/events.ts");
  const mapper = await read("src/lib/email/stalwart-events.ts");
  assert.match(adapter, /STALWART_WEBHOOK_SECRET/);
  assert.match(adapter, /x-signature/);
  assert.match(adapter, /ingestEmailSuppressions/);
  assert.match(shared, /recordEmailSuppression/);
  assert.match(mapper, /delivery\.dsn-perm-fail/);
  assert.match(mapper, /data\.to/);
  assert.doesNotMatch(mapper, /complaint.*=>|reason: "complaint"/);
  const caddy = await read("infra/product/Caddyfile");
  assert.match(caddy, /@stalwart_webhook_public path \/api\/internal\/email\/stalwart/);
  assert.match(caddy, /respond @stalwart_webhook_public "not found" 404/);
});
