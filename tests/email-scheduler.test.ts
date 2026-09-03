import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("email drain scheduler fails closed and signs the internal request", () => {
  const source = readFileSync("scripts/vps/email-outbox-drain.sh", "utf8");
  assert.match(source, /EMAIL_PROVIDER must be smtp or explicit resend/);
  assert.match(source, /SMTP_HOST/);
  assert.match(source, /RESEND_API_KEY/);
  assert.match(source, /x-blockwise-signature/);
  assert.match(source, /email\.drain/);
  assert.ok(existsSync("infra/product/systemd/blockwise-email-outbox-drain.service"));
  assert.ok(existsSync("infra/product/systemd/blockwise-email-outbox-drain.timer"));
  assert.match(source, /node -e/);
  assert.doesNotMatch(source, /openssl dgst -sha256 -hmac/);
  assert.match(source, /BLOCKWISE_INTERNAL_AUTH_SECRET/);
  const unit = readFileSync("infra/product/systemd/blockwise-email-outbox-drain.timer", "utf8");
  assert.match(unit, /OnUnitActiveSec=1min/);
  assert.match(unit, /Persistent=true/);
});
