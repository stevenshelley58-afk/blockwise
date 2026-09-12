import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Meta-connect preview has one isolated flag, base path and no product integrations", async () => {
  const [config, layout, proxy] = await Promise.all([
    read("next.config.ts"),
    read("src/app/layout.tsx"),
    read("src/proxy.ts"),
  ]);

  assert.match(config, /BLOCKWISE_META_CONNECT_PREVIEW/);
  assert.match(config, /"\/meta-connect-preview"/);
  assert.match(config, /Only one isolated Blockwise preview may be built at a time/);
  assert.match(config, /X-Robots-Tag/);
  assert.match(config, /connect-src 'self'/);
  assert.match(layout, /const ISOLATED_PREVIEW = HOMEPAGE_PREVIEW \|\| META_CONNECT_PREVIEW/);
  assert.match(layout, /!ISOLATED_PREVIEW && <MarketingAnalytics/);
  assert.match(layout, /!ISOLATED_PREVIEW && <ServiceWorkerRegistrar/);
  assert.match(layout, /!ISOLATED_PREVIEW && <ConsentBanner/);
  assert.match(layout, /\{!ISOLATED_PREVIEW && \(\s*<Script id="sidebar-theme-init"/);
  assert.match(proxy, /pathname === "\/concept\/meta-connect"/);
  assert.match(proxy, /request\.method !== "GET" && request\.method !== "HEAD"/);
  assert.match(proxy, /pathname === "\/" && request\.method === "GET"/);
  assert.match(proxy, /X-Preview-Revision/);
  assert.match(proxy, /requestHeaders\.delete\("authorization"\)/);
  assert.match(proxy, /requestHeaders\.delete\("cookie"\)/);
  assert.doesNotMatch(proxy.slice(proxy.indexOf("if (homepagePreview || metaConnectPreview)"), proxy.indexOf("if (process.env.NODE_ENV")), /refreshSupabaseSession|providerCallbackRecovery/);
});

test("the image and router route are bounded to the Meta-connect preview", async () => {
  const [dockerfile, ignore, router] = await Promise.all([
    read("infra/product/Dockerfile.meta-connect-preview"),
    read("infra/product/Dockerfile.meta-connect-preview.dockerignore"),
    read("scripts/vps/meta-connect-preview-route.py"),
  ]);

  assert.match(dockerfile, /BLOCKWISE_META_CONNECT_PREVIEW=true/);
  assert.match(dockerfile, /meta-connect-preview\/concept\/meta-connect/);
  assert.doesNotMatch(dockerfile, /COPY[^\n]+public \.\/public/);
  assert.match(ignore, /!public\/brand\/blockwise-logo\.svg/);
  assert.match(router, /ROUTE_ID = "blockwise-meta-connect-preview"/);
  assert.match(router, /"\/meta-connect-preview\/\*"/);
  assert.match(router, /\["GET", "HEAD"\]/);
  assert.match(router, /\["Cookie", "Authorization"\]/);
  assert.match(router, /Router changed concurrently; inspect before retrying/);
  assert.match(router, /Only the isolated Meta-connect preview upstream is allowed/);
  assert.doesNotMatch(router, /homepage-preview/);
});
