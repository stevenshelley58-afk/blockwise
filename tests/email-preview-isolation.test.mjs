import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy.ts";

test("email preview allows only read-only design review and never calls a provider", async () => {
  const previous = process.env.BLOCKWISE_EMAIL_PREVIEW;
  const originalFetch = globalThis.fetch;
  process.env.BLOCKWISE_EMAIL_PREVIEW = "true";
  globalThis.fetch = () => { throw new Error("Preview attempted a network call"); };
  try {
    for (const [path, method, expected] of [
      ["/email-design", "GET", 200],
      ["/email-design", "HEAD", 200],
      ["/_next/static/test.js", "GET", 200],
      ["/api/health", "GET", 404],
      ["/api/internal/email", "GET", 404],
      ["/login", "GET", 404],
      ["/email-design", "POST", 405],
      ["/api/internal/email", "POST", 405],
    ]) {
      const response = await proxy(new NextRequest(`https://blockwise.sale${path}`, {
        method, headers: { Cookie: "sb-preview-auth-token=not-a-real-token" },
      }));
      assert.equal(response.status, expected, `${method} ${path}`);
      assert.equal(response.headers.get("set-cookie"), null);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.BLOCKWISE_EMAIL_PREVIEW;
    else process.env.BLOCKWISE_EMAIL_PREVIEW = previous;
  }
});
