import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("email event webhook binds authentication to the exact raw body", () => {
  const source = readFileSync("src/app/api/internal/email/events/route.ts", "utf8");
  assert.match(source, /const rawBody = await request\.text\(\)/);
  assert.match(source, /verifyInternalRequest\(request, "email\.events", \{ body: rawBody \}\)/);
  assert.match(source, /body = JSON\.parse\(rawBody\)/);
  assert.doesNotMatch(source, /request\.json\(\)/);
});
