import assert from "node:assert/strict";
import test from "node:test";

import { recordCloneCandidateAudit } from "../src/lib/adstudio/clone-candidate-audit.ts";
import type { AdStudioCloneQualityReview } from "../src/lib/adstudio/types.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";

function review(): AdStudioCloneQualityReview {
  return {
    schemaVersion: 1,
    templateId: "template-1",
    format: "4:5",
    attempt: 1,
    referenceHash: "a".repeat(64),
    candidateHash: "b".repeat(64),
    requestHash: "c".repeat(64),
    adSystemLikenessScore: 9.6,
    standaloneAdQualityScore: 9.2,
    excludedContentInfluencedScore: false,
    copyChecks: [], assetChecks: [], identityLeakage: [], defects: [],
    includedRationale: "matches", qualityRationale: "clean", suggestedCorrection: "",
  };
}

test("candidate audit persists pending evidence before QA and finalizes the same row", async () => {
  const uploads: string[] = [];
  const rows: Record<string, unknown>[] = [];
  const supabase = {
    storage: { from: () => ({ upload: async (path: string) => { uploads.push(path); return { error: null }; } }) },
    from: () => ({ upsert: async (row: Record<string, unknown>) => { rows.push(row); return { error: null }; } }),
  };
  const input = {
    supabase,
    workspaceId,
    correlationId: "run-1",
    templateId: "template-1",
    format: "4:5" as const,
    attempt: 1,
    request: { prompt: "clone", referenceAssets: [], aspectRatio: "4:5", stylePreset: "test" },
    accepted: false,
  };
  const path = await recordCloneCandidateAudit({ ...input, candidateImage: "data:image/png;base64,aGVsbG8=" });
  await recordCloneCandidateAudit({ ...input, candidateImagePath: path, review: review(), accepted: true });

  assert.equal(uploads.length, 1);
  assert.equal(rows[0]?.qa_status, "pending");
  assert.equal(rows[0]?.review_json, null);
  assert.equal(rows[1]?.qa_status, "passed");
  assert.equal((rows[1]?.review_json as AdStudioCloneQualityReview).adSystemLikenessScore, 9.6);
});
