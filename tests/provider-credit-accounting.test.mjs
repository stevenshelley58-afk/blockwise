import test from "node:test";
import assert from "node:assert/strict";
import { readScrapingBeeReceipt } from "../hermes/tools/research-runtime/bin/provider-credit-accounting.mjs";
test("charge headers are read before a body can fail", () => {
 const headers = new Headers({ "spb-cost": "12", "spb-request-id": "r1" });
 assert.deepEqual(readScrapingBeeReceipt(headers,25), { chargeKnown:true,credits:12,requestId:"r1" });
});
test("missing or invalid charge holds the reservation", () => {
 assert.equal(readScrapingBeeReceipt(new Headers(),25).chargeKnown,false);
 assert.equal(readScrapingBeeReceipt(new Headers({"spb-cost":"26"}),25).chargeKnown,false);
});
