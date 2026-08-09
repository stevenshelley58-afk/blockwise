import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readAdStudioCreativeJobStatus } from "../src/lib/adstudio/job-status.ts";

test("generation-job API keeps status inside the shared job envelope", () => {
  const route = readFileSync("src/app/api/adstudio/jobs/[id]/route.ts", "utf8");
  assert.match(route, /return NextResponse\.json\(\{\s*job:\s*\{/u);
});

test("generation-job status reader unwraps a terminal failed response", () => {
  const job = readAdStudioCreativeJobStatus({
    job: {
      id: "14235a66-9479-496a-ad66-f009d8f7b714",
      status: "failed",
      error: "Generation provider timed out.",
      campaign_id: null,
    },
  });

  assert.equal(job?.status, "failed");
  assert.equal(job?.error, "Generation provider timed out.");
});

test("generation-job status reader rejects a flattened response instead of polling it forever", () => {
  const job = readAdStudioCreativeJobStatus({
    id: "14235a66-9479-496a-ad66-f009d8f7b714",
    status: "failed",
    error: "Generation provider timed out.",
    campaign_id: null,
  });

  assert.equal(job, null);
});
