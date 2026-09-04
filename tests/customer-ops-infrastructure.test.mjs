import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const text = (path) => readFileSync(new URL(path, root), "utf8");

test("customer operations keeps one mail server and wires private control edge", () => {
  const customerCompose = text("infra/customer-ops/docker-compose.yml");
  const productCompose = text("infra/coolify/docker-compose.product.yml");
  const controlCompose = text("ops/control-edge/docker-compose.yml");
  const controlDockerfile = text("ops/control-edge/Dockerfile");
  assert.equal((customerCompose.match(/^  (?:product-)?stalwart:/gm) ?? []).length, 0);
  assert.match(customerCompose, /name: blockwise-customer-ops-mail/);
  assert.match(productCompose, /product-mail:[\s\S]*customer-ops-mail:/);
  assert.match(controlCompose, /CONTROL_EDGE_IMAGE:\?Set/);
  assert.match(controlCompose, /CONTROL_EDGE_INTERNAL_AUTH_HOST_FILE:[\s\S]*\/run\/secrets\/internal-auth:ro/);
  assert.match(controlCompose, /healthcheck:[\s\S]*health\/live/);
  assert.match(controlDockerfile, /^FROM node:[^@]+@sha256:[0-9a-f]{64}$/m);
  assert.doesNotMatch(controlCompose, /\/etc\/blockwise\/customer-ops\/secrets:\/run\/secrets/);
});

test("bootstrap is explicit, idempotent, and credential-file based", () => {
  const bootstrap = text("scripts/vps/customer-ops-bootstrap.sh");
  const env = text("infra/customer-ops/customer-ops.env.example");
  const runbook = text("docs/runbooks/customer-ops-vps.md");
  assert.match(bootstrap, /--apply/);
  assert.match(bootstrap, /fields\/contact\/new/);
  assert.match(bootstrap, /accounts\/\$\{CHATWOOT_ACCOUNT_ID\}\/inboxes/);
  assert.match(bootstrap, /accounts\/\$\{CHATWOOT_ACCOUNT_ID\}\/webhooks/);
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
