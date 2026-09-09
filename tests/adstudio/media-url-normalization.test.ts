import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { customerReachableStorageUrl } from "../../src/lib/adstudio/media-urls.ts";

const env = {
  BLOCKWISE_SUPABASE_INTERNAL_URL: "http://product-caddy",
  NEXT_PUBLIC_SUPABASE_URL: "https://blockwise.sale",
};

describe("Ad Studio signed media URL normalization", () => {
  it("rewrites the trusted private product origin and preserves the signed path and query", () => {
    const signed = "http://product-caddy/storage/v1/object/sign/workspace-artifacts/workspace-1/adstudio/feed.png?token=abc%2B123&download=feed.png";

    assert.equal(
      customerReachableStorageUrl(signed, env),
      "https://blockwise.sale/storage/v1/object/sign/workspace-artifacts/workspace-1/adstudio/feed.png?token=abc%2B123&download=feed.png",
    );
  });

  it("preserves a signed URL already hosted on the configured public origin", () => {
    const signed = "https://blockwise.sale/storage/v1/render/image/sign/workspace-artifacts/workspace-1/adstudio/feed.png?token=public-token&width=640";

    assert.equal(customerReachableStorageUrl(signed, env), signed);
  });

  it("keeps a valid same-origin signed path relative", () => {
    const signed = "/storage/v1/object/sign/workspace-artifacts/workspace-1/adstudio/feed.png?token=relative-token";

    assert.equal(customerReachableStorageUrl(signed, {}), signed);
  });

  it("rejects signed-looking URLs from foreign hosts", () => {
    assert.throws(
      () => customerReachableStorageUrl(
        "https://attacker.example/storage/v1/object/sign/workspace-artifacts/workspace-1/adstudio/feed.png?token=stolen",
        env,
      ),
      /untrusted host/u,
    );
  });
});
