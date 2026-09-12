import test from "node:test";
import assert from "node:assert/strict";
import config from "../../next.config.ts";

test("only the bundled Vue editor can be embedded and it cannot call upstream services", async () => {
  const rules = await config.headers!();
  const common = rules.find(rule => rule.source === "/:path*")!;
  const editor = rules.find(rule => rule.source === "/vue-ad-editor/:path*")!;
  const value = (rule: typeof editor, key: string) => rule.headers.find(header => header.key === key)?.value ?? "";
  assert.equal(value(common, "X-Frame-Options"), "DENY");
  assert.match(value(common, "Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.equal(value(editor, "X-Frame-Options"), "SAMEORIGIN");
  const policy = value(editor, "Content-Security-Policy");
  assert.match(policy, /frame-ancestors 'self'/);
  assert.match(policy, /connect-src 'self' blob:/);
  assert.doesNotMatch(policy, /https?:|unsafe-eval/);
  assert.equal(value(editor, "Cache-Control"), "no-cache");
});
