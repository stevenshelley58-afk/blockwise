import assert from "node:assert/strict";
import test from "node:test";

import { buildLeadDedupeKey, findDuplicateLeadIds } from "../src/lib/leads/dedupe.ts";

test("buildLeadDedupeKey normalizes email and phone", () => {
  assert.equal(
    buildLeadDedupeKey({
      email: " Owner+Guide@Example.COM ",
      phone: " (08) 9123 4567 ",
    }),
    "email:owner+guide@example.com|phone:0891234567",
  );
});

test("findDuplicateLeadIds matches incoming leads by normalized dedupe key", () => {
  const duplicates = findDuplicateLeadIds(
    [
      { id: "lead_1", email: "seller@example.com", phone: "0400 111 222" },
      { id: "lead_2", email: "buyer@example.com", phone: "0400 999 888" },
    ],
    { email: " SELLER@example.com ", phone: "0400111222" },
  );

  assert.deepEqual(duplicates, ["lead_1"]);
});
