import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(
  new URL("../src/app/api/operator/template-trace/[id]/regenerate/route.ts", import.meta.url),
  "utf8",
);

test("Template Trace accounts test renders against the operator's real workspace", () => {
  assert.match(routeSource, /\.from\("workspace_members"\)/);
  assert.match(routeSource, /\.eq\("profile_id", guard\.userId\)/);
  assert.match(routeSource, /workspaceId: membership\.workspace_id/);
  assert.doesNotMatch(routeSource, /workspaceId:\s*"operator-trace"/);
});
