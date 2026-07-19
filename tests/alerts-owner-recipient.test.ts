import assert from "node:assert/strict";
import test from "node:test";

import { resolveAlertEmailRecipient } from "../src/lib/alerts/notify.ts";

test("resolveAlertEmailRecipient prefers explicit env over the owner default", () => {
  assert.equal(
    resolveAlertEmailRecipient({ ALERT_EMAIL_TO: "ops@blockwise.test" }),
    "ops@blockwise.test",
  );
  assert.equal(
    resolveAlertEmailRecipient({ DEMO_NOTIFY_TO: "demo@blockwise.test" }),
    "demo@blockwise.test",
  );
  assert.equal(
    resolveAlertEmailRecipient({ BLOCKWISE_OWNER_ALERT_EMAIL: "owner@blockwise.test" }),
    "owner@blockwise.test",
  );
});

test("resolveAlertEmailRecipient falls back to the owner inbox when nothing is set", () => {
  const recipient = resolveAlertEmailRecipient({});
  assert.match(recipient, /@/);
  assert.equal(recipient, "stevenshelley58@gmail.com");
});
