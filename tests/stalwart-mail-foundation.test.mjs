import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { validateExternalUrl } from "../scripts/vps/external-target.mjs";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("Stalwart foundation is pinned, isolated and mail-only at the host", async () => {
  const compose = await read("infra/coolify/docker-compose.product.yml");
  const service = compose.slice(compose.indexOf("  product-mail:"), compose.indexOf("  product-auth:"));
  assert.match(service, /image: stalwartlabs\/stalwart:v0\.16\.20@sha256:74ca4f7f6885fe302f38a99381f36a208547afce1033d8734d9e6d8d3eba7446/);
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
  assert.match(validation, /smtp-validate\.mjs/);
  assert.doesNotMatch(validation, /\*localhost\*|\*127\.0\.0\.1\*/);
  const health = await read("scripts/vps/product-health.sh");
  assert.match(health, /product-mail health is not healthy/);
  assert.match(health, /\.Health/);
  assert.match(health, /mail-validate\.sh/);
  assert.match(await read("scripts/vps/product-health.sh"), /must be true for production readiness/);
  const backup = await read("scripts/vps/stalwart-backup.sh");
  assert.match(backup, /mail backup blocked/);
  assert.match(backup, /status=running/);
  assert.match(backup, /alpine:3\.22\.1@sha256:eafc1edb577d2e9b458664a15f23ea1c370214193226069eb22921169fc7e43f/);
  const acceptance = await read("scripts/vps/gotrue-mail-acceptance.mjs");
  assert.match(acceptance, /BLOCKWISE_ACCEPTANCE_APPLY=true/);
  assert.match(acceptance, /localhost, private and managed targets are refused/);
  assert.match(acceptance, /\/user/);
  assert.match(acceptance, /replayRejected/);
  assert.match(acceptance, /fetchTextBodyValues: true/);
  assert.match(acceptance, /fetchHTMLBodyValues: true/);
  assert.match(acceptance, /message\.to/);
  assert.match(acceptance, /throw new AcceptanceFailure/);
  assert.match(acceptance, /flow === "signup" \? \["BLOCKWISE_ACCEPTANCE_PASSWORD"\]/);
  assert.match(acceptance, /replace\(\/&amp;\/gu, "&"\)/);
  assert.match(acceptance, /validateExternalUrl/);
  assert.match(acceptance, /redirected\.origin !== siteUrl\.origin/);
  const output = execFileSync("node", ["scripts/vps/gotrue-mail-acceptance.mjs"], { cwd: root, encoding: "utf8" });
  assert.match(output, /"status":"preflight"/);
});

test("external acceptance targets reject loopback, private, link-local and reserved IPs by parsed hostname", () => {
  for (const raw of [
    "https://localhost/",
    "https://127.0.0.1/",
    "https://10.1.2.3/",
    "https://172.16.0.1/",
    "https://192.168.1.1/",
    "https://169.254.169.254/",
    "https://[::1]/",
    "https://[fc00::1]/",
    "https://[fe80::1]/",
    "https://[2001:db8::1]/",
    "https://preview.vercel.app/",
    "https://project.supabase.co/",
  ]) assert.equal(validateExternalUrl(raw), null, raw);
  assert.equal(validateExternalUrl("https://localhost.evil.example/")?.hostname, "localhost.evil.example");
  assert.equal(validateExternalUrl("https://mail.blockwise.sale/" )?.hostname, "mail.blockwise.sale");
  assert.equal(validateExternalUrl("http://mail.blockwise.sale/"), null);
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
  assert.match(caddy, /handle @stalwart_webhook_public \{[\s\S]*respond "not found" 404/);
  assert.ok(caddy.indexOf("handle @stalwart_webhook_public") < caddy.indexOf("handle /api/*"));
});
