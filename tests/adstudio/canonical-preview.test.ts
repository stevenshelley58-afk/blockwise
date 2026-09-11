import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createCanonicalPreviewController,
  isCanonicalPreviewRequestReady,
} from "../../src/components/adstudio/editor/canonical-preview.ts";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function response(body: string, documentHash = "sha256:doc", templateHash = "sha256:template") {
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      "x-blockwise-document-hash": documentHash,
      "x-blockwise-template-hash": templateHash,
    }),
    blob: async () => new Blob([body], { type: "image/png" }),
  } as unknown as Response;
}

const document = { schema: "blockwise.ad-document", templateId: "template-1" } as never;

describe("canonical editor preview handoff", () => {
  it("does not consider an unresolved ad/document requestable", () => {
    assert.equal(isCanonicalPreviewRequestReady({ adId: "", workspaceId: "workspace-1", document }), false);
    assert.equal(isCanonicalPreviewRequestReady({ adId: "ad-1", workspaceId: "", document }), false);
    assert.equal(isCanonicalPreviewRequestReady({ adId: "ad-1", workspaceId: "workspace-1", document: null }), false);
    assert.equal(isCanonicalPreviewRequestReady({ adId: "ad-1", workspaceId: "workspace-1", document }), true);
  });

  it("posts the active placement and hands the server PNG to the editor", async () => {
    const calls: Array<{ endpoint: unknown; init: RequestInit | undefined }> = [];
    const states: string[] = [];
    const controller = createCanonicalPreviewController(
      async (endpoint, init) => {
        calls.push({ endpoint, init });
        return response("feed");
      },
      {
        createObjectURL: () => "blob:feed",
        revokeObjectURL: () => {},
      },
    );

    controller.request({
      endpoint: "/api/adstudio/ads/ad-1/preview?workspaceId=workspace-1",
      document,
      placement: "feed",
      debounceMs: 0,
      onState: (state) => states.push(state.status + ":" + (state.url ?? "")),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, "/api/adstudio/ads/ad-1/preview?workspaceId=workspace-1");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { document, placement: "feed" });
    assert.deepEqual(states, ["pending:", "ready:blob:feed"]);
  });

  it("changes placement, aborts the old request, and ignores its stale response", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const calls: Array<RequestInit | undefined> = [];
    const states: string[] = [];
    const revoked: string[] = [];
    let responseNumber = 0;
    const controller = createCanonicalPreviewController(
      async (_endpoint, init) => {
        calls.push(init);
        responseNumber += 1;
        return responseNumber === 1 ? first.promise : second.promise;
      },
      {
        createObjectURL: () => "blob:generated-" + String(revoked.length + 1),
        revokeObjectURL: (url) => revoked.push(url),
      },
    );

    controller.request({ endpoint: "/preview", document, placement: "feed", debounceMs: 0, onState: (s) => states.push(s.status) });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.request({ endpoint: "/preview", document, placement: "story", debounceMs: 0, onState: (s) => states.push(s.status) });
    await new Promise<void>((resolve) => setImmediate(resolve));

    first.resolve(response("old"));
    second.resolve(response("new"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(String(calls[1]?.body)), { document, placement: "story" });
    assert.deepEqual(states, ["pending", "pending", "ready"]);
    assert.deepEqual(revoked, ["blob:generated-1"]);
  });

  it("keeps the displayed frame while the next one renders", async () => {
    const second = deferred<Response>();
    const states: Array<{ status: string; url: string | null }> = [];
    const revoked: string[] = [];
    let serial = 0;
    const controller = createCanonicalPreviewController(
      async () => {
        serial += 1;
        return serial === 1 ? response("first") : second.promise;
      },
      {
        createObjectURL: () => "blob:" + String(serial),
        revokeObjectURL: (url) => revoked.push(url),
      },
    );
    const record = (state: { status: string; url: string | null }) => states.push({ status: state.status, url: state.url });

    controller.request({ endpoint: "/preview", document, placement: "feed", debounceMs: 0, onState: record });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(states.at(-1), { status: "ready", url: "blob:1" });

    // Editing again: the new frame is still rendering, so the old one stays up
    // and its URL is not released yet.
    controller.request({ endpoint: "/preview", document, placement: "feed", debounceMs: 0, onState: record });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(states.at(-1), { status: "pending", url: "blob:1" });
    assert.deepEqual(revoked, []);

    second.resolve(response("second"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(states.at(-1), { status: "ready", url: "blob:2" });
    assert.deepEqual(revoked, ["blob:1"]);

    controller.dispose();
    assert.deepEqual(revoked, ["blob:1", "blob:2"]);
  });

  it("revokes the active object URL when replaced or disposed", async () => {
    const revoked: string[] = [];
    let serial = 0;
    const controller = createCanonicalPreviewController(
      async () => response("image-" + String(++serial)),
      {
        createObjectURL: () => "blob:" + String(serial),
        revokeObjectURL: (url) => revoked.push(url),
      },
    );

    const ready = () => {};
    controller.request({ endpoint: "/preview", document, placement: "feed", debounceMs: 0, onState: ready });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.request({ endpoint: "/preview", document, placement: "feed", debounceMs: 0, onState: ready });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.dispose();

    assert.deepEqual(revoked, ["blob:1", "blob:2"]);
  });
});