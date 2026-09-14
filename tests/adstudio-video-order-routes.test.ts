import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");
/** Prose that explains a rule must not satisfy a check about the code. */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    // Import specifiers name a symbol without calling it, so they must not be
    // mistaken for a call site when checking ordering.
    .replace(/^\s*import[\s\S]*?from\s+"[^"]+";?$/gm, "");

const checkout = "src/app/api/adstudio/videos/[id]/checkout/route.ts";
const order = "src/app/api/adstudio/videos/[id]/order/route.ts";
const brief = "src/app/api/adstudio/videos/[id]/brief/route.ts";
const videos = "src/app/api/adstudio/videos/route.ts";

test("paid checkout is gated before anything else happens", () => {
  const source = code(checkout);
  const gate = source.indexOf("assertCheckoutEnabled(");
  assert.ok(gate >= 0, "the checkout route must consult the gate");

  for (const late of [
    "requireApiWorkspace(",
    "createSupabaseServiceClient(",
    "checkRateLimit(",
    "stripe",
    "checkout/sessions",
  ]) {
    const at = source.toLowerCase().indexOf(late.toLowerCase());
    if (at >= 0) {
      assert.ok(gate < at, `the gate must run before ${late}`);
    }
  }
});

test("checkout cannot reach Stripe while the gate is closed", () => {
  const source = code(checkout);
  // No session creation call exists yet, by design.
  assert.doesNotMatch(source, /checkout\/sessions/, "no Stripe session may be created while gated");
  assert.doesNotMatch(source, /mode:\s*["']payment["']/);
});

test("a paid order can never be charged a second time", () => {
  const source = code(checkout);
  assert.match(source, /order\.payment_state === "paid"/);
  assert.match(source, /already paid/);
});

test("checkout refuses an order from another workspace", () => {
  const source = code(checkout);
  assert.match(source, /\.eq\("id", orderId\)/);
  assert.match(source, /\.eq\("workspace_id", workspaceId\)/);
});

test("checkout refuses an order whose brief is not frozen and complete", () => {
  const source = code(checkout);
  assert.match(source, /!brief \|\| !brief\.frozen_at \|\| brief\.is_complete !== true/);
});

test("creating an order never touches Stripe", () => {
  const source = code(order);
  assert.doesNotMatch(source, /stripe/i);
  assert.doesNotMatch(source, /video_payment_attempts/);
});

test("an order can only be created for a commissioned project that is yours", () => {
  const source = read("src/lib/adstudio/video-order.ts");
  assert.match(source, /\.eq\("id", projectId\)/);
  assert.match(source, /\.eq\("workspace_id", workspaceId\)/);
  assert.match(source, /project\.mode !== "commissioned"/);
});

test("the brief is frozen, not copied, so the version shown is the version bought", () => {
  const source = read("src/lib/adstudio/video-order.ts");
  assert.match(source, /\.is\("frozen_at", null\)/, "the customer's own draft is the row that is frozen");
  assert.match(source, /frozen_at: now\.toISOString\(\)/);
});

test("submitting twice resumes the pending order instead of creating another", () => {
  const source = read("src/lib/adstudio/video-order.ts");
  assert.match(source, /\.eq\("payment_state", "pending"\)/);
  assert.match(source, /if \(existing\) \{/);
});

test("only ready customer-visible assets count towards completeness", () => {
  const source = read("src/lib/adstudio/video-order.ts");
  assert.match(source, /\.eq\("visibility", "customer"\)/);
  assert.match(source, /\.eq\("upload_state", "ready"\)/);
});

test("the deadline is computed by the database, not in application code", () => {
  const source = read("src/lib/adstudio/video-order.ts");
  assert.match(source, /rpc\("video_order_first_draft_due_at"/);
  // The order's own frozen terms are passed, not the current offer config.
  assert.match(source, /p_working_days: order\.delivery_working_days/);
  assert.match(source, /p_timezone: order\.due_timezone/);
});

test("a replayed payment event cannot re-date an order", () => {
  const source = read("src/lib/adstudio/video-order.ts");
  assert.match(source, /order\.payment_state === "paid"/);
  assert.match(source, /never re-date an order/);
  // The update is guarded on the pending state, so a replay matches no row.
  assert.match(source, /\.eq\("payment_state", "pending"\)/);
});

test("the brief autosave cannot create a payment record", () => {
  const source = code(brief);
  assert.doesNotMatch(source, /video_orders/, "autosave must not create an order");
  assert.doesNotMatch(source, /stripe/i);
  assert.doesNotMatch(source, /payment_attempts/);
});

test("the brief autosave keeps one working draft and never edits frozen history", () => {
  const source = code(brief);
  assert.match(source, /\.is\("frozen_at", null\)/);
  assert.match(source, /frozen_at: null/);
});

test("a reference url is stored as text and never fetched", () => {
  const source = code(brief);
  assert.match(source, /must be a web address/);
  assert.doesNotMatch(source, /await fetch\(/, "the server must not fetch a customer-supplied url");
});

test("free uploads still create no payment record", () => {
  const source = code(videos);
  assert.doesNotMatch(source, /video_orders/);
  assert.doesNotMatch(source, /stripe/i);
  assert.doesNotMatch(source, /payment_attempts/);
});
