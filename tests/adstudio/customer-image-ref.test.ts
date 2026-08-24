import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCustomerImageRef, imageSha256, parseCustomerImageRef } from "../../src/lib/adstudio/customer-image-ref.ts";
import { containsInlineImageData, withPersistedDocumentHash } from "../../src/lib/adstudio/persisted-document.ts";

describe("customer image references", () => {
  it("creates a workspace- and ad-scoped ref without base64", () => {
    const hash = imageSha256(Buffer.from("image-bytes"));
    const ref = buildCustomerImageRef("ws-1", "ad-1", hash, "image/png");
    assert.match(ref, /^\/api\/adstudio\/customer-media\?/);
    assert.match(ref, /workspaceId=ws-1/);
    assert.doesNotMatch(ref, /base64|image-bytes/);
    assert.deepEqual(parseCustomerImageRef(ref, "ws-1", "ad-1"), {
      path: `ws-1/adstudio/ads/ad-1/images/${hash}.png`,
      sha256: hash,
      mime: "image/png",
    });
  });

  it("rejects cross-workspace, cross-ad, traversal, and tampered refs", () => {
    const hash = "a".repeat(64);
    const ref = buildCustomerImageRef("ws-1", "ad-1", hash, "image/jpeg");
    assert.equal(parseCustomerImageRef(ref, "ws-2", "ad-1"), null);
    assert.equal(parseCustomerImageRef(ref, "ws-1", "ad-2"), null);
    assert.equal(parseCustomerImageRef(ref.replace(hash, "b".repeat(64)), "ws-1", "ad-1"), null);
    assert.equal(parseCustomerImageRef(ref.replace("path=", "path=../"), "ws-1", "ad-1"), null);
    assert.equal(parseCustomerImageRef(ref.replace("workspaceId=ws-1", "workspaceId=ws-2"), "ws-1", "ad-1"), null);
    assert.equal(parseCustomerImageRef(ref.replace("workspaceId=ws-1&", ""), "ws-1", "ad-1"), null);
  });

  it("rehashes the ref-only persisted document and detects no inline image data", () => {
    const hash = "a".repeat(64);
    const ref = buildCustomerImageRef("ws-1", "ad-1", hash, "image/png");
    const document = withPersistedDocumentHash({
      schema: "blockwise.ad-document/v1",
      templateId: "template",
      templateVersion: 1,
      templateHash: "b".repeat(64),
      rendererVersion: "1",
      sharedImageValues: { hero: ref },
      sharedTextValues: {}, feedCropOverrides: {}, storyCropOverrides: {},
      colourMode: "template", resolvedColourMap: { background: "#fff" },
      metaPrimaryText: "", metaHeadline: "", metaDescription: "", metaCta: "LEARN_MORE",
      revision: 1, documentHash: "0".repeat(64), lastRenderedHash: null,
    } as never);
    assert.equal(containsInlineImageData(document), false);
    assert.equal(document.documentHash, withPersistedDocumentHash(document).documentHash);
  });
});
