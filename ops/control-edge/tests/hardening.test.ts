import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedRequestBody, RequestBodyTooLargeError } from "../../../src/lib/ops/request-body.ts";
import { safeErrorCode } from "../src/safe-log.ts";

test("bounded request reader rejects oversized chunked bodies before full buffering", async () => {
  let cancelled = false;
  let chunksRead = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { if (chunksRead++ === 0) controller.enqueue(new TextEncoder().encode("12345")); else controller.enqueue(new TextEncoder().encode("67890")); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readBoundedRequestBody(new Request("https://private.invalid", { method: "POST", body: stream, duplex: "half" } as RequestInit), 8), RequestBodyTooLargeError);
  assert.equal(chunksRead, 2);
  assert.equal(cancelled, true);
});

test("error logger accepts stable codes and rejects arbitrary provider text", () => {
  assert.equal(safeErrorCode(new Error("billing_subscription_workspace_mismatch")), "billing_subscription_workspace_mismatch");
  assert.equal(safeErrorCode(new Error("Stripe secret at /run/secrets/key for https://provider.invalid")), "unknown_error");
  assert.equal(safeErrorCode(new Error("invitee@example.test")), "unknown_error");
});
