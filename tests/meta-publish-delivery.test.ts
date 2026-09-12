import assert from "node:assert/strict";
import test from "node:test";
import { summarizeMetaDelivery } from "../src/lib/providers/meta-publish-delivery.ts";
test("ACTIVE alone does not claim live delivery", () => assert.equal(summarizeMetaDelivery([{ configured_status: "ACTIVE", effective_status: "ACTIVE" }]), "pending"));
test("provider review and problems stay distinct", () => {
 assert.equal(summarizeMetaDelivery([{ effective_status: "PENDING_REVIEW" }]), "in_review");
 assert.equal(summarizeMetaDelivery([{ effective_status: "DISAPPROVED" }]), "needs_attention");
 assert.equal(summarizeMetaDelivery([{ effective_status: "ACTIVE" }], "2999-01-01"), "scheduled");
 assert.equal(summarizeMetaDelivery([]), "pending");
});
