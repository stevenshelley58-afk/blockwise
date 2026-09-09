import assert from "node:assert/strict";
import test from "node:test";

import {
  aiCopyProposalSelectionKeys,
  metaCopySelectionKey,
  onImageCopySelectionKey,
  selectedAiCopyPayload,
  type AiCopyProposal,
} from "../../src/components/adstudio/editor/ai-copy-selection.ts";

const proposal: AiCopyProposal = {
  onImage: {
    headline: "Open this Saturday",
    address: "18 Smith Street",
  },
  copy: {
    primaryText: "A light-filled home, open this Saturday.",
    headline: "See 18 Smith Street",
    description: "Request the property guide.",
    cta: "DOWNLOAD",
  },
  source: "ai",
};

test("AI copy selection keys namespace on-image and Meta fields without collisions", () => {
  const keys = aiCopyProposalSelectionKeys(proposal, ["address", "headline"]);
  assert.deepEqual(keys, [
    "onImage:address",
    "onImage:headline",
    "meta:primaryText",
    "meta:headline",
    "meta:description",
    "meta:cta",
  ]);
  assert.notEqual(onImageCopySelectionKey("headline"), metaCopySelectionKey("headline"));
});

test("selected AI copy becomes one partial atomic payload", () => {
  assert.deepEqual(
    selectedAiCopyPayload(proposal, [
      onImageCopySelectionKey("address"),
      metaCopySelectionKey("headline"),
      metaCopySelectionKey("cta"),
    ]),
    {
      onImage: { address: "18 Smith Street" },
      copy: { headline: "See 18 Smith Street", cta: "DOWNLOAD" },
    },
  );
});

test("unknown selections cannot inject fields into an AI apply payload", () => {
  assert.deepEqual(
    selectedAiCopyPayload(proposal, ["onImage:unknown", "meta:unknown"] as never[]),
    { onImage: {}, copy: {} },
  );
});
