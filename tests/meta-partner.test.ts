import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import {
  getMetaPartnerConfig,
  listPartnerVisibleAdAccounts,
  verifyPartnerAccountAccess,
} from "../src/lib/providers/meta-partner.ts";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("getMetaPartnerConfig", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env = { ...saved };
  });

  afterEach(() => {
    process.env = saved;
  });

  test("returns null when business id or token is missing", () => {
    delete process.env.META_BUSINESS_ID;
    delete process.env.META_SYSTEM_USER_TOKEN;
    assert.equal(getMetaPartnerConfig(), null);

    process.env.META_BUSINESS_ID = "3701213676688100";
    assert.equal(getMetaPartnerConfig(), null);
  });

  test("treats a PLACEHOLDER token as unconfigured", () => {
    process.env.META_BUSINESS_ID = "3701213676688100";
    process.env.META_SYSTEM_USER_TOKEN = "PLACEHOLDER_PASTE_REAL_EAAG_TOKEN";
    assert.equal(getMetaPartnerConfig(), null);
  });

  test("returns trimmed values when fully configured", () => {
    process.env.META_BUSINESS_ID = "  3701213676688100  ";
    process.env.META_SYSTEM_USER_TOKEN = "  EAAG_real_token  ";
    assert.deepEqual(getMetaPartnerConfig(), {
      businessId: "3701213676688100",
      systemToken: "EAAG_real_token",
    });
  });
});

test("listPartnerVisibleAdAccounts maps Graph accounts into claim candidates", async () => {
  const requested: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requested.push(String(input));
    return json({
      data: [
        {
          id: "act_9001",
          name: "Northstar Realty",
          currency: "AUD",
          timezone_name: "Australia/Perth",
          account_status: 1,
          business: { name: "Northstar Pty Ltd" },
        },
        {
          id: "act_9002",
          name: "Disabled Account",
          account_status: 2,
        },
      ],
      paging: {},
    });
  };

  try {
    const accounts = await listPartnerVisibleAdAccounts("EAAG_real_token");

    assert.equal(accounts.length, 2);
    assert.deepEqual(accounts[0], {
      id: "act_9001",
      name: "Northstar Realty",
      currency: "AUD",
      timezone: "Australia/Perth",
      isActive: true,
      businessName: "Northstar Pty Ltd",
    });
    assert.equal(accounts[1].isActive, false);
    assert.equal(accounts[1].businessName, null);
    assert.ok(requested[0].includes("/me/adaccounts"));
    assert.ok(requested[0].includes("access_token=EAAG_real_token"));
  } finally {
    globalThis.fetch = original;
  }
});

test("verifyPartnerAccountAccess prefixes act_ and reports reachability", async () => {
  const requested: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requested.push(String(input));
    return json({ id: "act_9001", name: "Northstar Realty" });
  };

  try {
    const ok = await verifyPartnerAccountAccess("EAAG_real_token", "9001");
    assert.equal(ok, true);
    assert.ok(requested[0].includes("/act_9001"));
    assert.ok(!requested[0].includes("/act_act_"));
  } finally {
    globalThis.fetch = original;
  }
});
