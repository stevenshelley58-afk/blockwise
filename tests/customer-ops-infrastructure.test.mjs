import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const text = (path) => readFileSync(new URL(path, root), "utf8").replaceAll("\r", "");

test("customer operations keeps one mail server and wires private control edge", () => {
  const customerCompose = text("infra/customer-ops/docker-compose.yml");
  const productCompose = text("infra/coolify/docker-compose.product.yml");
  const controlCompose = text("ops/control-edge/docker-compose.yml");
  const controlDockerfile = text("ops/control-edge/Dockerfile");
  const workerDockerfile = text("worker/Dockerfile");
  assert.equal((customerCompose.match(/^  (?:product-)?stalwart:/gm) ?? []).length, 0);
  assert.match(customerCompose, /name: blockwise-customer-ops-mail/);
  assert.match(productCompose, /product-mail:[\s\S]*customer-ops-mail:/);
  assert.match(controlCompose, /CONTROL_EDGE_IMAGE:\?Set/);
  assert.match(controlCompose, /CONTROL_EDGE_INTERNAL_AUTH_HOST_FILE:[\s\S]*\/run\/secrets\/internal-auth:ro/);
  assert.match(controlCompose, /healthcheck:[\s\S]*health\/live/);
  assert.match(controlDockerfile, /^FROM node:[^@]+@sha256:[0-9a-f]{64}$/m);
  assert.match(workerDockerfile, /^FROM node:[^@]+@sha256:[0-9a-f]{64}/m);
  assert.doesNotMatch(controlCompose, /\/etc\/blockwise\/customer-ops\/secrets:\/run\/secrets/);
});

test("production runtime has one projection writer and the accepted Frank RO handoff", () => {
  const productCompose = text("infra/coolify/docker-compose.product.yml");
  const standaloneWorker = text("worker/docker-compose.worker.yml");
  const frankCompose = text("infra/frank/docker-compose.customer-ops.yml");
  const frankRunbook = text("docs/runbooks/frank-ops-integrity-followup.md");
  assert.equal((productCompose.match(/\/data\/ops-projections:rw/g) ?? []).length, 1);
  assert.doesNotMatch(standaloneWorker, /ops-projections:rw/);
  assert.match(frankCompose, /ops-projections:ro/);
  assert.doesNotMatch(frankCompose, /blockwise-product|hermes-private/);
  assert.match(frankRunbook, /Frank #122/);
  assert.match(frankRunbook, /single writer/);
});

test("production worker/control-edge compose uses immutable images and file secrets", () => {
  const productCompose = text("infra/coolify/docker-compose.product.yml");
  const controlCompose = text("ops/control-edge/docker-compose.yml");
  const workerCompose = text("worker/docker-compose.worker.yml");
  assert.doesNotMatch(productCompose, /product-worker:[\s\S]*?\n\s+build:/);
  assert.doesNotMatch(controlCompose, /customer-ops-control-edge:[\s\S]*?\n\s+build:/);
  assert.match(productCompose, /BLOCKWISE_WORKER_IMAGE:\?BLOCKWISE_WORKER_IMAGE is required/);
  assert.match(productCompose, /BLOCKWISE_WORKER_EXPECTED_REVISION:\?BLOCKWISE_WORKER_EXPECTED_REVISION is required/);
  assert.match(productCompose, /SUPABASE_SERVICE_ROLE_KEY_HOST_FILE:[\s\S]*supabase-service-role:ro/);
  assert.match(productCompose, /SUPABASE_SERVICE_ROLE_KEY_FILE: \/run\/secrets\/supabase-service-role/);
  assert.match(productCompose, /SUPABASE_SERVICE_ROLE_KEY_HOST_FILE:[\s\S]*supabase-service-role:ro/);
  assert.doesNotMatch(productCompose, /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{/);
  assert.doesNotMatch(productCompose, /product-worker:[\s\S]*?SUPABASE_SERVICE_ROLE_KEY:/);
  assert.match(workerCompose, /SUPABASE_SERVICE_ROLE_KEY_HOST_FILE:[\s\S]*supabase-service-role:ro/);
  assert.match(controlCompose, /CONTROL_EDGE_EXPECTED_REVISION/);
  assert.match(controlCompose, /\/app\/REVISION/);
});

test("bootstrap is explicit, idempotent, and credential-file based", () => {
  const bootstrap = text("scripts/vps/customer-ops-bootstrap.sh");
  const env = text("infra/customer-ops/customer-ops.env.example");
  const runbook = text("docs/runbooks/customer-ops-vps.md");
  assert.match(bootstrap, /--apply/);
  assert.match(bootstrap, /fields\/contact\/new/);
  assert.match(bootstrap, /accounts\/\$\{CHATWOOT_ACCOUNT_ID\}\/inboxes/);
  assert.match(bootstrap, /accounts\/\$\{CHATWOOT_ACCOUNT_ID\}\/webhooks/);
  assert.match(bootstrap, /api_access_token/);
  assert.doesNotMatch(bootstrap, /chatwoot_webhook_secret/);
  assert.match(bootstrap, /chatwoot_webhook_probe_secret/);
  assert.match(bootstrap, /tags\/new/);
  assert.match(bootstrap, /verify_mautic_resource segments/);
  assert.match(bootstrap, /verify_mautic_resource campaigns/);
  assert.match(bootstrap, /require_value CHATWOOT_INBOX_PAYLOAD_FILE/);
  assert.match(bootstrap, /require_value CHATWOOT_WEBHOOK_URL/);
  assert.match(bootstrap, /CHATWOOT_INBOX_PAYLOAD_FILE.*root-owned/);
  assert.match(bootstrap, /curl --config "\$config"/);
  assert.doesNotMatch(bootstrap, /Authorization: Bearer "\$\{/);
  assert.match(env, /MAUTIC_LIFECYCLE_FIELDS_JSON=/);
  assert.match(env, /MAUTIC_LIFECYCLE_SEGMENTS_JSON=/);
  assert.match(env, /MAUTIC_LIFECYCLE_CAMPAIGNS_JSON=/);
  assert.match(runbook, /Receipt-based staging smoke matrix/);
  for (const marker of ["Signup magic link", "Transactional mail", "External support mail", "Support reply", "Mautic contact\/flow", "SnagTime booking", "Control action"]) {
    assert.match(runbook, new RegExp(marker));
  }
  assert.doesNotMatch(runbook, /adapter remains explicitly deferred|adapter contract exists, the webhook assertion is explicitly deferred/i);
});

test("provider worker healthchecks and SnagTime runtime contract are explicit", () => {
  const customerCompose = text("infra/customer-ops/docker-compose.yml");
  for (const service of ["mautic-cron", "mautic-worker", "snagtime-worker"]) {
    const section = customerCompose.match(new RegExp(`  ${service}:[\\s\\S]*?(?=\\n  [A-Za-z0-9_-]+:|$)`))?.[0] ?? "";
    assert.match(section, /healthcheck:/, `${service} healthcheck missing`);
  }
  assert.match(customerCompose, /WORKER_DATABASE_URL_FILE: \/run\/secrets\/worker_database_url/);
  for (const key of ["BOOKING_CAPABILITY_KEY_ID", "EMAIL_TOKEN_SECRET_FILE", "TENANT_CONTEXT_SECRET_FILE", "RATE_LIMIT_HASH_SECRET_FILE", "PROXY_SHARED_SECRET_FILE", "OPERATOR_HEALTH_SECRET_FILE", "BLOCKWISE_WEBHOOK_SECRET_FILE", "BLOCKWISE_BOOKING_ACTION_SECRET_FILE"]) {
    assert.match(customerCompose, new RegExp(key));
  }
  assert.doesNotMatch(customerCompose, /SNAGTIME_WORKER_HEARTBEAT_FILE/);
});
