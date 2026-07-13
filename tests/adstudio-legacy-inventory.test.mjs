import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(repoRoot, "scripts", "migrations", "snapshot-legacy-creatives.mjs");
const inventory = await import(pathToFileURL(scriptPath).href);

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function initializeIgnoredArtifactsRepo(root) {
  runGit(root, ["init", "--quiet"]);
  await writeFile(path.join(root, ".gitignore"), "artifacts/\n", "utf8");
}

function canvasObject(overrides = {}) {
  return {
    objectId: "object-1",
    type: "shape",
    role: "background",
    x: 0,
    y: 0,
    width: 100,
    locked: false,
    ...overrides,
  };
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SUPABASE_SECRET_KEY: "",
      ...env,
    },
  });
}

test("CLI rejects invocation without --dry-run before credentials are loaded", () => {
  const result = runCli([]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--dry-run is required/i);
  assert.doesNotMatch(result.stderr, /missing env/i);
});

test("CLI rejects live execution flags even when --dry-run is present", () => {
  const result = runCli(["--dry-run", "--execute"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /live execution flags are forbidden/i);
  assert.doesNotMatch(result.stderr, /missing env/i);
});

test("CLI rejects every unsupported flag before credentials are loaded", () => {
  const result = runCli(["--dry-run", "--output=somewhere.json"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsupported argument/i);
  assert.doesNotMatch(result.stderr, /missing env/i);
});

test("Gate 0 executable contains no renderer, mutation, provider, or storage-write path", async () => {
  const source = await readFile(scriptPath, "utf8");

  assert.doesNotMatch(source, /playwright|chromium\.launch/i);
  assert.doesNotMatch(source, /\.upload\s*\(|\.remove\s*\(/i);
  assert.doesNotMatch(source, /\.from\([^)]*\)[\s\S]{0,500}\.(?:update|upsert|delete)\s*\(/i);
  assert.doesNotMatch(source, /resolveRuntimeModelProfile|provider[_-]run|generateImage/i);
  assert.doesNotMatch(source, /\.arrayBuffer\s*\(/i);
  assert.doesNotMatch(source, /readFile\(filePath\)/i);
});

test("module import has no CLI, credential, or network side effects", () => {
  const moduleUrl = pathToFileURL(scriptPath).href;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(moduleUrl)})`],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_URL: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
        SUPABASE_SECRET_KEY: "",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("credential loader accepts the current Supabase secret key and prefers an explicit legacy service-role key", () => {
  assert.deepEqual(
    inventory.requireEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_current",
    }),
    {
      url: "https://example.supabase.co",
      serviceRoleKey: "sb_secret_current",
    },
  );

  assert.deepEqual(
    inventory.requireEnv({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role",
      SUPABASE_SECRET_KEY: "sb_secret_current",
    }),
    {
      url: "https://example.supabase.co",
      serviceRoleKey: "legacy-service-role",
    },
  );

  assert.throws(
    () => inventory.requireEnv({ SUPABASE_URL: "https://example.supabase.co" }),
    /SUPABASE_SECRET_KEY \(or SUPABASE_SERVICE_ROLE_KEY\)/,
  );
});

test("private Storage headers use opaque secret keys as apikey-only and legacy JWTs as Bearer credentials", () => {
  assert.deepEqual(inventory.buildSupabaseStorageHeaders("sb_secret_current"), {
    apikey: "sb_secret_current",
    Accept: "image/*",
  });
  assert.deepEqual(inventory.buildSupabaseStorageHeaders("eyJlegacy-service-role"), {
    apikey: "eyJlegacy-service-role",
    Accept: "image/*",
    Authorization: "Bearer eyJlegacy-service-role",
  });
  assert.throws(() => inventory.buildSupabaseStorageHeaders(""), /secret or legacy service-role key/);
});

test("classifier recognizes exact flat clones and unambiguous legacy composites", () => {
  assert.equal(typeof inventory.classifyProposedRenderKind, "function");
  assert.deepEqual(
    inventory.classifyProposedRenderKind({
      objects: [canvasObject({ objectId: "template_clone_image", type: "image", role: "template_clone" })],
    }),
    { kind: "flat_clone", reason: "exact_clone_marker" },
  );
  assert.deepEqual(
    inventory.classifyProposedRenderKind({
      objects: [
        canvasObject({ objectId: "headline", type: "text", role: "headline" }),
        canvasObject({ objectId: "photo", type: "image", role: "primary_photo" }),
      ],
    }),
    { kind: "legacy_composite", reason: "multiple_legacy_objects" },
  );
});

test("classifier quarantines malformed, empty, single non-clone, and hybrid canvases", () => {
  const cases = [
    [null, "objects_not_array"],
    [{ objects: [] }, "empty_objects"],
    [{ objects: [canvasObject({ objectId: "headline", type: "text", role: "headline" })] }, "single_non_clone"],
    [
      {
        objects: [
          canvasObject({ objectId: "template_clone_image", type: "image", role: "template_clone" }),
          canvasObject({ objectId: "headline", type: "text", role: "headline" }),
        ],
      },
      "hybrid_clone_marker",
    ],
  ];

  for (const [canvas, reason] of cases) {
    assert.deepEqual(inventory.classifyProposedRenderKind(canvas), { kind: "unknown", reason });
  }
});

test("classifier quarantines every canvas containing a malformed object shape", () => {
  const malformedObjects = [
    null,
    {},
    canvasObject({ objectId: "" }),
    canvasObject({ type: "video" }),
    canvasObject({ role: "" }),
    canvasObject({ x: Number.NaN }),
    canvasObject({ y: null }),
    canvasObject({ width: 0 }),
    canvasObject({ locked: "false" }),
    canvasObject({ height: 0 }),
    canvasObject({ size: Number.POSITIVE_INFINITY }),
    canvasObject({ lineHeight: 0 }),
    canvasObject({ opacity: 2 }),
    canvasObject({ align: "justify" }),
    canvasObject({ clip: "triangle" }),
    canvasObject({ imageAnchor: "middle_left" }),
    canvasObject({ font: "system" }),
    canvasObject({ customerSupplied: "yes" }),
  ];

  for (const malformed of malformedObjects) {
    const result = inventory.classifyProposedRenderKind({
      objects: [canvasObject({ objectId: "valid-a" }), malformed, canvasObject({ objectId: "valid-b" })],
    });
    assert.deepEqual(result, { kind: "unknown", reason: "malformed_object_shape" });
  }
});

test("canonical JSON sorts object keys, preserves array order, and hashes deterministically", () => {
  assert.equal(typeof inventory.canonicalJson, "function");
  assert.equal(typeof inventory.sha256Canonical, "function");

  const left = { z: 1, nested: { b: true, a: "value" }, array: [2, 1] };
  const right = { array: [2, 1], nested: { a: "value", b: true }, z: 1 };

  assert.equal(inventory.canonicalJson(left), inventory.canonicalJson(right));
  assert.equal(inventory.sha256Canonical(left), inventory.sha256Canonical(right));
  assert.notEqual(inventory.sha256Canonical(left), inventory.sha256Canonical({ ...right, array: [1, 2] }));
  assert.match(inventory.sha256Canonical(left), /^[a-f0-9]{64}$/);
});

function renderInputFixture() {
  return {
    row: {
      id: "creative-1",
      workspace_id: "workspace-1",
      campaign_id: "campaign-1",
      variant_id: "variant-1",
      format: "4:5",
      width: 1080,
      height: 1350,
      canvas_json: {
        height: 1350,
        objects: [
          canvasObject({
            objectId: "headline",
            type: "text",
            role: "headline",
            content: "Sold",
            x: 10,
            y: 20,
            width: 500,
          }),
          canvasObject({
            objectId: "photo",
            type: "image",
            role: "primary_photo",
            content: "/hero.jpg",
            width: 1080,
          }),
        ],
        width: 1080,
      },
    },
    campaign: { id: "campaign-1", workspace_id: "workspace-1", brand_kit_id: "brand-1" },
    variant: { id: "variant-1", workspace_id: "workspace-1", campaign_id: "campaign-1" },
    brandKit: {
      id: "brand-1",
      workspace_id: "workspace-1",
      business_name: "Example Realty",
      identity_json: { businessName: "Example Realty", tradingName: "Example" },
      typography_json: {
        headingFont: "Inter",
        bodyFont: "Arial",
        fallbackHeading: "sans-serif",
        fallbackBody: "sans-serif",
      },
    },
    assets: [
      {
        objectIndex: 1,
        objectId: "photo",
        slot: "image",
        referenceSha256: "a".repeat(64),
        contentSha256: "b".repeat(64),
        mimeType: "image/jpeg",
        byteLength: 1234,
      },
    ],
    rendererSourceSha256: "c".repeat(64),
  };
}

test("render-input v1 hash commits to identity, dimensions, canvas, brand context, renderer, and assets", () => {
  assert.equal(typeof inventory.buildRenderInputRecord, "function");
  const fixture = renderInputFixture();
  const base = inventory.buildRenderInputRecord(fixture);

  assert.equal(base.input.schema, "adstudio-legacy-render-input/v1");
  assert.equal(base.canvasSha256, inventory.sha256Canonical(fixture.row.canvas_json));
  assert.match(base.renderInputSha256, /^[a-f0-9]{64}$/);

  const variations = [
    { ...fixture, row: { ...fixture.row, workspace_id: "workspace-2" } },
    { ...fixture, row: { ...fixture.row, width: 1079 } },
    {
      ...fixture,
      row: { ...fixture.row, canvas_json: { ...fixture.row.canvas_json, backgroundAssetId: "changed" } },
    },
    {
      ...fixture,
      brandKit: { ...fixture.brandKit, typography_json: { ...fixture.brandKit.typography_json, headingFont: "Georgia" } },
    },
    {
      ...fixture,
      assets: [{ ...fixture.assets[0], contentSha256: "d".repeat(64) }],
    },
    { ...fixture, rendererSourceSha256: "e".repeat(64) },
  ];

  for (const changed of variations) {
    assert.notEqual(inventory.buildRenderInputRecord(changed).renderInputSha256, base.renderInputSha256);
  }
});

test("asset resolver decodes data images and records byte-level evidence", async () => {
  assert.equal(typeof inventory.resolveAssetReference, "function");
  const bytes = Buffer.from("small-image-fixture");
  const reference = `data:image/png;base64,${bytes.toString("base64")}`;
  const resolved = await inventory.resolveAssetReference({
    reference,
    workspaceId: "workspace-1",
    objectIndex: 2,
    objectId: "photo",
    slot: "image",
  });

  assert.deepEqual(resolved, {
    objectIndex: 2,
    objectId: "photo",
    slot: "image",
    referenceSha256: inventory.sha256Text(reference),
    contentSha256: inventory.sha256Bytes(bytes),
    mimeType: "image/png",
    byteLength: bytes.length,
  });
});

test("data image byte cap is checked before invoking the base64 decoder", () => {
  assert.equal(typeof inventory.decodeBoundedDataImage, "function");
  let decoded = false;
  const reference = `data:image/png;base64,${Buffer.alloc(5).toString("base64")}`;

  assert.throws(
    () =>
      inventory.decodeBoundedDataImage(reference, 4, () => {
        decoded = true;
        return Buffer.alloc(5);
      }),
    /exceeds 4 byte limit/i,
  );
  assert.equal(decoded, false);
});

test("asset resolver hashes percent-encoded renderer-supported images", async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
  const reference = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  const resolved = await inventory.resolveAssetReference({
    reference,
    workspaceId: "workspace-1",
    objectIndex: 0,
    objectId: "preview",
    slot: "image",
    maxBytes: 1024,
  });

  assert.equal(resolved.mimeType, "image/svg+xml");
  assert.equal(resolved.byteLength, Buffer.byteLength(svg));
  assert.equal(resolved.contentSha256, inventory.sha256Text(svg));
});

test("pinned lookup supports Node single-address and all-address callback shapes", () => {
  const lookup = inventory.createPinnedLookup("93.184.216.34", 4);
  lookup("public.example", {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, "93.184.216.34");
    assert.equal(family, 4);
  });
  lookup("public.example", { all: true }, (error, addresses) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]);
  });
});

test("asset resolver rejects private storage paths outside the creative workspace", async () => {
  let downloaded = false;

  await assert.rejects(
    inventory.resolveAssetReference({
      reference: "/api/adstudio/media?path=workspace-2%2Fphoto.png",
      workspaceId: "workspace-1",
      objectIndex: 0,
      objectId: "photo",
      slot: "image",
      storageDownload: async () => {
        downloaded = true;
        return { bytes: Buffer.from("no"), mimeType: "image/png" };
      },
    }),
    /outside workspace/i,
  );
  assert.equal(downloaded, false);
});

test("asset resolver reads repository-public files without permitting path traversal", async (t) => {
  const publicRoot = await mkdtemp(path.join(os.tmpdir(), "adstudio-inventory-public-"));
  t.after(() => rm(publicRoot, { recursive: true, force: true }));
  const bytes = Buffer.from("public-image");
  await writeFile(path.join(publicRoot, "photo.png"), bytes);

  const resolved = await inventory.resolveAssetReference({
    reference: "/photo.png",
    workspaceId: "workspace-1",
    objectIndex: 1,
    objectId: "photo",
    slot: "image",
    publicRoot,
  });
  assert.equal(resolved.contentSha256, inventory.sha256Bytes(bytes));
  assert.equal(resolved.mimeType, "image/png");

  await assert.rejects(
    inventory.resolveAssetReference({
      reference: "/../outside.png",
      workspaceId: "workspace-1",
      objectIndex: 1,
      objectId: "photo",
      slot: "image",
      publicRoot,
    }),
    /path traversal/i,
  );
});

test("asset resolver rejects public assets reached through a symlink or junction", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adstudio-inventory-public-link-"));
  const publicRoot = path.join(root, "public");
  const outsideRoot = path.join(root, "outside");
  await mkdir(publicRoot);
  await mkdir(outsideRoot);
  await writeFile(path.join(outsideRoot, "photo.png"), Buffer.from("outside"));
  const linkPath = path.join(publicRoot, "escape");
  await symlink(outsideRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    inventory.resolveAssetReference({
      reference: "/escape/photo.png",
      workspaceId: "workspace-1",
      objectIndex: 0,
      objectId: "photo",
      slot: "image",
      publicRoot,
    }),
    /symbolic link|junction|outside public root/i,
  );
});

test("asset resolver rejects oversized public files from stat before opening a read stream", async (t) => {
  const publicRoot = await mkdtemp(path.join(os.tmpdir(), "adstudio-inventory-public-limit-"));
  t.after(() => rm(publicRoot, { recursive: true, force: true }));
  await writeFile(path.join(publicRoot, "large.png"), Buffer.alloc(5));

  await assert.rejects(
    inventory.resolveAssetReference({
      reference: "/large.png",
      workspaceId: "workspace-1",
      objectIndex: 0,
      objectId: "photo",
      slot: "image",
      publicRoot,
      maxBytes: 4,
    }),
    /exceeds 4 byte limit/i,
  );
});

test("asset resolver bounds authenticated storage streams before collecting bytes", async () => {
  let streamRead = false;
  const body = {
    getReader() {
      streamRead = true;
      throw new Error("declared oversized storage body must not be opened");
    },
  };

  await assert.rejects(
    inventory.resolveAssetReference({
      reference: "/api/adstudio/media?path=workspace-1%2Flarge.png",
      workspaceId: "workspace-1",
      objectIndex: 0,
      objectId: "photo",
      slot: "image",
      maxBytes: 4,
      storageDownload: async () => ({
        body,
        contentLength: 5,
        mimeType: "image/png",
      }),
    }),
    /exceeds 4 byte limit/i,
  );
  assert.equal(streamRead, false, "declared oversized storage objects must be rejected before reading");
});

test("asset resolver cancels an authenticated storage stream that exceeds the undeclared byte cap", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.alloc(3));
      controller.enqueue(Buffer.alloc(3));
    },
    cancel() {
      cancelled = true;
    },
  });

  await assert.rejects(
    inventory.resolveAssetReference({
      reference: "/api/adstudio/media?path=workspace-1%2Flarge.png",
      workspaceId: "workspace-1",
      objectIndex: 0,
      objectId: "photo",
      slot: "image",
      maxBytes: 4,
      storageDownload: async () => ({ body, mimeType: "image/png" }),
    }),
    /exceeds 4 byte limit/i,
  );
  assert.equal(cancelled, true);
});

function remoteResponse({
  statusCode = 200,
  body = Buffer.from("remote-image"),
  mimeType = "image/png",
  location,
  remoteAddress = "93.184.216.34",
} = {}) {
  return {
    statusCode,
    headers: {
      ...(mimeType ? { "content-type": mimeType } : {}),
      ...(location ? { location } : {}),
      ...(body ? { "content-length": String(body.byteLength) } : {}),
    },
    body: body === null ? null : new Blob([body]).stream(),
    remoteAddress,
  };
}

test("remote asset resolver blocks private hosts and private redirects before fetching them", async () => {
  let requests = 0;
  const remoteRequest = async ({ url, address }) => {
    requests += 1;
    assert.equal(address, "93.184.216.34");
    if (url.toString() === "https://public.example/photo.png") {
      return remoteResponse({ statusCode: 302, body: null, mimeType: null, location: "https://127.0.0.1/private.png" });
    }
    throw new Error(`unexpected request ${url}`);
  };
  const lookupHost = async () => [{ address: "93.184.216.34", family: 4 }];

  await assert.rejects(
    inventory.resolveAssetReference({
      reference: "https://127.0.0.1/private.png",
      workspaceId: "workspace-1",
      objectIndex: 0,
      objectId: "photo",
      slot: "image",
      remoteRequest,
      lookupHost,
    }),
    /private or reserved/i,
  );
  assert.equal(requests, 0);

  await assert.rejects(
    inventory.resolveAssetReference({
      reference: "https://public.example/photo.png",
      workspaceId: "workspace-1",
      objectIndex: 0,
      objectId: "photo",
      slot: "image",
      remoteRequest,
      lookupHost,
    }),
    /private or reserved/i,
  );
  assert.equal(requests, 1);
});

test("remote asset resolver rejects DNS rebinding at connect time", async () => {
  await assert.rejects(
    inventory.resolveAssetReference({
      reference: "https://public.example/photo.png",
      workspaceId: "workspace-1",
      objectIndex: 0,
      objectId: "photo",
      slot: "image",
      lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
      remoteRequest: async ({ address }) => {
        assert.equal(address, "93.184.216.34");
        return remoteResponse({ remoteAddress: "127.0.0.1" });
      },
    }),
    /connected address did not match the validated address/i,
  );
});

test("remote address policy comprehensively rejects non-global IPv4 and IPv6", () => {
  assert.equal(typeof inventory.isGloballyRoutableAddress, "function");
  const blocked = [
    "0.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.0.1",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.0.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b:1::1",
    "100::1",
    "100:0:0:1::1",
    "2001:db8::1",
    "2002::1",
    "3ffe::1",
    "3fff::1",
    "4000::1",
    "5f00::1",
    "fc00::1",
    "fec0::1",
    "fe80::1",
    "ff00::1",
  ];
  for (const address of blocked) assert.equal(inventory.isGloballyRoutableAddress(address), false, address);

  const globallyReachable = [
    "8.8.8.8",
    "93.184.216.34",
    "192.0.0.9",
    "192.0.0.10",
    "192.31.196.1",
    "192.52.193.1",
    "192.175.48.1",
    "64:ff9b::808:808",
    "2001:1::1",
    "2001:3::1",
    "2001:4:112::1",
    "2001:20::1",
    "2001:30::1",
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
  ];
  for (const address of globallyReachable) {
    assert.equal(inventory.isGloballyRoutableAddress(address), true, address);
  }
});

test("remote asset resolver blocks hexadecimal IPv4-mapped IPv6 private addresses", async () => {
  let fetched = false;

  await assert.rejects(
    inventory.resolveAssetReference({
      reference: "https://[::ffff:127.0.0.1]/private.png",
      workspaceId: "workspace-1",
      objectIndex: 0,
      objectId: "photo",
      slot: "image",
      remoteRequest: async () => {
        fetched = true;
        throw new Error("must not request");
      },
    }),
    /private or reserved/i,
  );
  assert.equal(fetched, false);
});

test("remote asset resolver aborts once the byte limit is exceeded", async () => {
  const remoteRequest = async ({ address }) =>
    remoteResponse({ body: Buffer.from("too-large"), mimeType: "image/jpeg", remoteAddress: address });

  await assert.rejects(
    inventory.resolveAssetReference({
      reference: "https://public.example/photo.jpg",
      workspaceId: "workspace-1",
      objectIndex: 0,
      objectId: "photo",
      slot: "image",
      remoteRequest,
      lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
      maxBytes: 4,
    }),
    /exceeds 4 byte limit/i,
  );
});

test("remote asset resolver rejects a declared oversized response without reading its body", async () => {
  let streamRead = false;
  const body = {
    getReader() {
      streamRead = true;
      throw new Error("declared oversized remote body must not be opened");
    },
  };

  await assert.rejects(
    inventory.resolveAssetReference({
      reference: "https://public.example/photo.jpg",
      workspaceId: "workspace-1",
      objectIndex: 0,
      objectId: "photo",
      slot: "image",
      maxBytes: 4,
      lookupHost: async () => [{ address: "93.184.216.34", family: 4 }],
      remoteRequest: async ({ address }) => ({
        ...remoteResponse({ body: null, mimeType: "image/jpeg", remoteAddress: address }),
        headers: { "content-type": "image/jpeg", "content-length": "5" },
        body,
      }),
    }),
    /exceeds 4 byte limit/i,
  );
  assert.equal(streamRead, false);
});

test("canvas asset collection follows renderer-consumed image and logo slots and skips placeholder images", async () => {
  assert.equal(typeof inventory.resolveCanvasAssets, "function");
  const first = `data:image/png;base64,${Buffer.from("first").toString("base64")}`;
  const second = `data:image/jpeg;base64,${Buffer.from("second").toString("base64")}`;
  const assets = await inventory.resolveCanvasAssets({
    canvas: {
      objects: [
        { objectId: "headline", type: "text", content: "Text" },
        { objectId: "photo", type: "image", content: first, assetId: "unused" },
        { objectId: "wordmark", type: "logo", content: "Fallback brand", assetId: second },
        { objectId: "fallback-logo", type: "logo", content: "Fallback brand" },
      ],
    },
    workspaceId: "workspace-1",
  });

  assert.deepEqual(
    assets.map(({ objectIndex, objectId, slot }) => ({ objectIndex, objectId, slot })),
    [
      { objectIndex: 1, objectId: "photo", slot: "image" },
      { objectIndex: 2, objectId: "wordmark", slot: "logo" },
    ],
  );

  assert.deepEqual(
    await inventory.resolveCanvasAssets({
      canvas: { objects: [{ objectId: "photo", type: "image" }] },
      workspaceId: "workspace-1",
    }),
    [],
  );
});

function createReadOnlySupabaseFixture(rowsByTable, { serverCap = Number.POSITIVE_INFINITY } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, filters: [], columns: null, limit: null };
      const builder = {
        select(columns) {
          call.columns = columns;
          return this;
        },
        eq(column, value) {
          call.filters.push({ operator: "eq", column, value });
          return this;
        },
        in(column, values) {
          call.filters.push({ operator: "in", column, value: values });
          return this;
        },
        gt(column, value) {
          call.filters.push({ operator: "gt", column, value });
          return this;
        },
        order() {
          return this;
        },
        limit(value) {
          call.limit = value;
          return this;
        },
        then(resolve, reject) {
          calls.push(call);
          const source = rowsByTable[table];
          let rows = [...(typeof source === "function" ? source({ call, calls }) : (source ?? []))];
          for (const filter of call.filters) {
            if (filter.operator === "eq") rows = rows.filter((row) => row[filter.column] === filter.value);
            if (filter.operator === "in") rows = rows.filter((row) => filter.value.includes(row[filter.column]));
            if (filter.operator === "gt") rows = rows.filter((row) => row[filter.column] > filter.value);
          }
          rows.sort((left, right) => String(left.id).localeCompare(String(right.id)));
          if (call.limit !== null) rows = rows.slice(0, Math.min(call.limit, serverCap));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test("workspace graph loader scopes every AdStudio query and validates graph ownership", async () => {
  assert.equal(typeof inventory.loadWorkspaceGraph, "function");
  const fixture = renderInputFixture();
  const supabase = createReadOnlySupabaseFixture({
    adstudio_creatives: [fixture.row],
    adstudio_campaigns: [fixture.campaign],
    adstudio_campaign_variants: [fixture.variant],
    adstudio_brand_kits: [fixture.brandKit],
  });

  const graph = await inventory.loadWorkspaceGraph({ supabase, workspaceId: "workspace-1", pageSize: 2 });
  assert.equal(graph.creatives.length, 1);
  assert.equal(graph.campaigns.get("campaign-1")?.brand_kit_id, "brand-1");
  assert.equal(graph.variants.get("variant-1")?.campaign_id, "campaign-1");
  assert.equal(graph.brandKits.get("brand-1")?.business_name, "Example Realty");

  for (const call of supabase.calls) {
    assert.ok(
      call.filters.some(
        (filter) => filter.operator === "eq" && filter.column === "workspace_id" && filter.value === "workspace-1",
      ),
      `${call.table} query omitted workspace_id`,
    );
  }
  assert.equal(supabase.calls.some((call) => /insert|update|upsert|delete|rpc/i.test(call.table)), false);
});

test("workspace graph keyset pagination continues through a server cap below the requested page size", async () => {
  const graph = workspaceGraphFixture();
  const supabase = createReadOnlySupabaseFixture(
    {
      adstudio_creatives: graph.creatives,
      adstudio_campaigns: [...graph.campaigns.values()],
      adstudio_campaign_variants: [...graph.variants.values()],
      adstudio_brand_kits: [...graph.brandKits.values()],
    },
    { serverCap: 1 },
  );

  const loaded = await inventory.loadWorkspaceGraph({ supabase, workspaceId: "workspace-1", pageSize: 10 });

  assert.deepEqual(loaded.creatives.map((row) => row.id), ["creative-1", "creative-2"]);
  assert.deepEqual([...loaded.variants.keys()].sort(), ["variant-1", "variant-2"]);
  assert.equal(
    supabase.calls.filter((call) => call.table === "adstudio_creatives").length,
    3,
    "two capped creative pages must be followed by an empty-page proof",
  );
});

test("workspace graph loader rejects missing or cross-workspace relationships", async () => {
  const fixture = renderInputFixture();
  const supabase = createReadOnlySupabaseFixture({
    adstudio_creatives: [fixture.row],
    adstudio_campaigns: [{ ...fixture.campaign, workspace_id: "workspace-2" }],
    adstudio_campaign_variants: [fixture.variant],
    adstudio_brand_kits: [fixture.brandKit],
  });

  await assert.rejects(
    inventory.loadWorkspaceGraph({ supabase, workspaceId: "workspace-1", pageSize: 2 }),
    /workspace graph validation failed/i,
  );
});

function workspaceGraphFixture() {
  const fixture = renderInputFixture();
  const image = `data:image/png;base64,${Buffer.from("workspace-image").toString("base64")}`;
  const legacy = {
    ...fixture.row,
    updated_at: "2026-07-13T00:00:00.000Z",
    render_status: "rendered",
    canvas_json: {
      ...fixture.row.canvas_json,
      objects: [
        canvasObject({
          objectId: "headline",
          type: "text",
          role: "headline",
          content: "Sold",
          x: 10,
          y: 20,
          width: 500,
        }),
        canvasObject({
          objectId: "photo",
          type: "image",
          role: "primary_photo",
          content: image,
          width: 1080,
        }),
      ],
    },
  };
  const clone = {
    ...legacy,
    id: "creative-2",
    variant_id: "variant-2",
    canvas_json: {
      width: 1080,
      height: 1350,
      objects: [
        canvasObject({
          objectId: "template_clone_image",
          type: "image",
          role: "template_clone",
          content: image,
          width: 1080,
        }),
      ],
    },
  };
  const secondVariant = { ...fixture.variant, id: "variant-2" };
  return {
    creatives: [clone, legacy],
    campaigns: new Map([[fixture.campaign.id, fixture.campaign]]),
    variants: new Map([
      [fixture.variant.id, fixture.variant],
      [secondVariant.id, secondVariant],
    ]),
    brandKits: new Map([[fixture.brandKit.id, fixture.brandKit]]),
  };
}

test("workspace inventory emits deterministic exact rows, aggregates, and set digests", async () => {
  assert.equal(typeof inventory.buildWorkspaceInventory, "function");
  const graph = workspaceGraphFixture();
  const first = await inventory.buildWorkspaceInventory({
    graph,
    workspaceId: "workspace-1",
    rendererSourceSha256: "c".repeat(64),
  });
  const second = await inventory.buildWorkspaceInventory({
    graph: { ...graph, creatives: [...graph.creatives].reverse() },
    workspaceId: "workspace-1",
    rendererSourceSha256: "c".repeat(64),
  });

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.rows.map((row) => [row.creativeId, row.proposedRenderKind, row.issues]),
    [
      ["creative-1", "legacy_composite", []],
      ["creative-2", "flat_clone", []],
    ],
  );
  assert.deepEqual(first.counts, {
    total: 2,
    flatClone: 1,
    legacyComposite: 1,
    unknown: 0,
    unresolved: 0,
    eligibleLegacy: 1,
    alreadySnapshotted: 0,
  });
  assert.match(first.creativeIdSetSha256, /^[a-f0-9]{64}$/);
  assert.match(first.renderInputSetSha256, /^[a-f0-9]{64}$/);
});

test("workspace inventory quarantines unknown canvases and dimension or asset failures", async () => {
  const graph = workspaceGraphFixture();
  const broken = {
    ...graph.creatives[0],
    id: "creative-broken",
    width: 999,
    canvas_json: {
      width: 1080,
      height: 1350,
      objects: [{ objectId: "photo", type: "image", content: "data:image/png;base64,not-valid" }],
    },
  };
  graph.creatives = [broken];

  const result = await inventory.buildWorkspaceInventory({
    graph,
    workspaceId: "workspace-1",
    rendererSourceSha256: "c".repeat(64),
  });

  assert.equal(result.counts.unknown, 1);
  assert.equal(result.counts.unresolved, 1);
  assert.deepEqual(
    result.rows[0].issues.map((issue) => issue.code),
    ["canvas_shape_invalid", "dimension_mismatch", "asset_resolution_failed"],
  );
});

test("workspace inventory marks malformed multi-object canvases unknown and unresolved", async () => {
  const graph = workspaceGraphFixture();
  graph.creatives = [
    {
      ...graph.creatives[0],
      id: "creative-malformed",
      canvas_json: {
        width: 1080,
        height: 1350,
        objects: [canvasObject({ objectId: "valid" }), null, {}],
      },
    },
  ];

  const result = await inventory.buildWorkspaceInventory({
    graph,
    workspaceId: "workspace-1",
    rendererSourceSha256: "c".repeat(64),
  });

  assert.equal(result.rows[0].proposedRenderKind, "unknown");
  assert.equal(result.rows[0].classificationReason, "malformed_object_shape");
  assert.equal(result.rows[0].renderInputSha256, null);
  assert.deepEqual(result.rows[0].issues.map((issue) => issue.code), ["canvas_shape_invalid"]);
  assert.equal(result.counts.unresolved, 1);
});

test("manifest compares two exact passes and marks drift or blocking rows non-acceptable", async () => {
  assert.equal(typeof inventory.buildInventoryManifest, "function");
  const workspace = await inventory.buildWorkspaceInventory({
    graph: workspaceGraphFixture(),
    workspaceId: "workspace-1",
    rendererSourceSha256: "c".repeat(64),
  });
  const input = {
    projectRef: "project-ref",
    sourceCommit: "f".repeat(40),
    toolSourceSha256: "a".repeat(64),
    rendererSourceSha256: "c".repeat(64),
    capturedAtStart: "2026-07-13T00:00:00.000Z",
    capturedAtEnd: "2026-07-13T00:01:00.000Z",
    firstPass: [workspace],
    secondPass: [workspace],
  };
  const stable = inventory.buildInventoryManifest(input);

  assert.equal(stable.schema, "adstudio-legacy-inventory/v1");
  assert.equal(stable.preliminaryPreFence, true);
  assert.equal(stable.drift.detected, false);
  assert.equal(stable.acceptanceEligible, true);
  assert.deepEqual(stable.totals, workspace.counts);
  assert.match(stable.manifestSha256, /^[a-f0-9]{64}$/);

  const changed = {
    ...workspace,
    renderInputSetSha256: "d".repeat(64),
  };
  const drifted = inventory.buildInventoryManifest({ ...input, secondPass: [changed] });
  assert.equal(drifted.drift.detected, true);
  assert.equal(drifted.acceptanceEligible, false);

  const blocked = {
    ...workspace,
    counts: { ...workspace.counts, unknown: 1 },
  };
  assert.equal(inventory.buildInventoryManifest({ ...input, firstPass: [blocked], secondPass: [blocked] }).acceptanceEligible, false);
});

test("drift digest covers every manifest-captured workspace and row field", async () => {
  const workspace = await inventory.buildWorkspaceInventory({
    graph: workspaceGraphFixture(),
    workspaceId: "workspace-1",
    rendererSourceSha256: "c".repeat(64),
  });
  const input = {
    projectRef: "project-ref",
    sourceCommit: "f".repeat(40),
    toolSourceSha256: "a".repeat(64),
    rendererSourceSha256: "c".repeat(64),
    capturedAtStart: "2026-07-13T00:00:00.000Z",
    capturedAtEnd: "2026-07-13T00:01:00.000Z",
    firstPass: [workspace],
  };
  const row = workspace.rows[0];
  const rowChanges = [
    { ...row, creativeId: "creative-other" },
    { ...row, workspaceId: "workspace-other" },
    { ...row, campaignId: "campaign-other" },
    { ...row, variantId: "variant-other" },
    { ...row, sourceVersion: "changed" },
    { ...row, renderStatus: "legacy_snapshot" },
    { ...row, format: "1:1" },
    { ...row, width: row.width + 1 },
    { ...row, height: row.height + 1 },
    { ...row, proposedRenderKind: "unknown" },
    { ...row, classificationReason: "changed" },
    { ...row, canvasSha256: "1".repeat(64) },
    { ...row, renderInputSha256: "2".repeat(64) },
    { ...row, assets: [...row.assets, { marker: "changed" }] },
    { ...row, issues: [{ code: "changed", message: "changed" }] },
  ];

  for (const changedRow of rowChanges) {
    const secondWorkspace = { ...workspace, rows: [changedRow, ...workspace.rows.slice(1)] };
    assert.equal(
      inventory.buildInventoryManifest({ ...input, secondPass: [secondWorkspace] }).drift.detected,
      true,
      `field change was omitted from drift digest: ${inventory.canonicalJson(changedRow)}`,
    );
  }

  const workspaceChanges = [
    { ...workspace, workspaceId: "workspace-other" },
    { ...workspace, counts: { ...workspace.counts, total: workspace.counts.total + 1 } },
    { ...workspace, creativeIdSetSha256: "3".repeat(64) },
    { ...workspace, renderInputSetSha256: "4".repeat(64) },
  ];
  for (const secondWorkspace of workspaceChanges) {
    assert.equal(inventory.buildInventoryManifest({ ...input, secondPass: [secondWorkspace] }).drift.detected, true);
  }
});

test("secure manifest writer is confined, atomic, exclusive, and mode 0600", async (t) => {
  assert.equal(typeof inventory.writeSecureManifest, "function");
  const root = await mkdtemp(path.join(os.tmpdir(), "adstudio-inventory-manifest-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeIgnoredArtifactsRepo(root);
  const outputPath = path.join(root, "artifacts", "adstudio", "evidence", "legacy-manifest.json");
  const manifest = { schema: "fixture", value: 1 };

  const written = await inventory.writeSecureManifest({ repoRoot: root, outputPath, manifest });
  assert.equal(written.outputPath, outputPath);
  assert.equal(JSON.parse(await readFile(outputPath, "utf8")).value, 1);
  assert.deepEqual(await readdir(path.dirname(outputPath)), ["legacy-manifest.json"]);
  assert.equal(written.permissionsVerified, true);
  assert.match(written.fileSha256, /^[a-f0-9]{64}$/);
  assert.equal(written.fileSha256, inventory.sha256Bytes(await readFile(outputPath)));
  if (process.platform !== "win32") {
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  }

  await assert.rejects(
    inventory.writeSecureManifest({ repoRoot: root, outputPath, manifest }),
    /already exists/i,
  );
  await assert.rejects(
    inventory.writeSecureManifest({ repoRoot: root, outputPath: path.join(root, "outside.json"), manifest }),
    /artifacts directory/i,
  );
});

test("secure manifest writer rejects unignored output and artifacts indirection", async (t) => {
  const unignoredRoot = await mkdtemp(path.join(os.tmpdir(), "adstudio-inventory-unignored-"));
  const linkedRoot = await mkdtemp(path.join(os.tmpdir(), "adstudio-inventory-linked-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "adstudio-inventory-outside-"));
  t.after(() => Promise.all([
    rm(unignoredRoot, { recursive: true, force: true }),
    rm(linkedRoot, { recursive: true, force: true }),
    rm(outsideRoot, { recursive: true, force: true }),
  ]));
  runGit(unignoredRoot, ["init", "--quiet"]);

  await assert.rejects(
    inventory.writeSecureManifest({
      repoRoot: unignoredRoot,
      outputPath: path.join(unignoredRoot, "artifacts", "evidence.json"),
      manifest: { schema: "fixture" },
    }),
    /must be ignored by git/i,
  );

  await initializeIgnoredArtifactsRepo(linkedRoot);
  await symlink(outsideRoot, path.join(linkedRoot, "artifacts"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    inventory.writeSecureManifest({
      repoRoot: linkedRoot,
      outputPath: path.join(linkedRoot, "artifacts", "evidence.json"),
      manifest: { schema: "fixture" },
    }),
    /symbolic link|junction|real path/i,
  );
  assert.deepEqual(await readdir(outsideRoot), []);
});

test("source evidence requires tracked script and renderer bytes to match HEAD", async (t) => {
  assert.equal(typeof inventory.collectVerifiedSourceEvidence, "function");
  const root = await mkdtemp(path.join(os.tmpdir(), "adstudio-inventory-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  runGit(root, ["init", "--quiet"]);
  runGit(root, ["config", "user.email", "inventory@example.invalid"]);
  runGit(root, ["config", "user.name", "Inventory Test"]);
  const localScript = path.join(root, "inventory.mjs");
  const localRenderer = path.join(root, "renderer.ts");
  await writeFile(localScript, "export const inventory = true;\n", "utf8");
  await writeFile(localRenderer, "export const renderer = true;\n", "utf8");
  runGit(root, ["add", "inventory.mjs", "renderer.ts"]);
  runGit(root, ["commit", "--quiet", "-m", "fixtures"]);

  const evidence = await inventory.collectVerifiedSourceEvidence({
    repoRoot: root,
    scriptPath: localScript,
    rendererPath: localRenderer,
  });
  assert.equal(evidence.sourceCommit, runGit(root, ["rev-parse", "HEAD"]));
  assert.equal(evidence.toolSourceSha256, inventory.sha256Bytes(await readFile(localScript)));
  assert.equal(evidence.rendererSourceSha256, inventory.sha256Bytes(await readFile(localRenderer)));

  runGit(root, ["update-index", "--assume-unchanged", "inventory.mjs"]);
  await writeFile(localScript, "export const inventory = false;\n", "utf8");
  await assert.rejects(
    inventory.collectVerifiedSourceEvidence({ repoRoot: root, scriptPath: localScript, rendererPath: localRenderer }),
    /must be tracked and match HEAD/i,
  );
});

test("workspace enumeration covers the root workspace table without unscoped AdStudio reads", async () => {
  assert.equal(typeof inventory.listWorkspaceIds, "function");
  const supabase = createReadOnlySupabaseFixture({
    workspaces: [{ id: "workspace-2" }, { id: "workspace-1" }],
  });

  assert.deepEqual(await inventory.listWorkspaceIds({ supabase, pageSize: 10 }), ["workspace-1", "workspace-2"]);
  assert.deepEqual(supabase.calls.map((call) => call.table), ["workspaces", "workspaces"]);
  assert.equal(supabase.calls[0].filters.some((filter) => filter.column === "workspace_id"), false);
});

test("workspace enumeration continues until an empty page under a lower server cap", async () => {
  const supabase = createReadOnlySupabaseFixture(
    {
      workspaces: [{ id: "workspace-3" }, { id: "workspace-1" }, { id: "workspace-2" }],
    },
    { serverCap: 1 },
  );

  assert.deepEqual(await inventory.listWorkspaceIds({ supabase, pageSize: 10 }), [
    "workspace-1",
    "workspace-2",
    "workspace-3",
  ]);
  assert.equal(supabase.calls.length, 4, "three capped pages must be followed by an empty-page proof");
});

test("inventory runner re-enumerates workspaces for pass two and detects a newly created workspace", async () => {
  let enumeration = 0;
  let currentWorkspaceRows = [];
  const supabase = createReadOnlySupabaseFixture({
    workspaces: ({ call }) => {
      const startsEnumeration = !call.filters.some((filter) => filter.operator === "gt");
      if (startsEnumeration) {
        enumeration += 1;
        currentWorkspaceRows =
          enumeration === 1 ? [{ id: "workspace-1" }] : [{ id: "workspace-1" }, { id: "workspace-2" }];
      }
      return currentWorkspaceRows;
    },
    adstudio_creatives: [],
  });
  let writtenManifest;

  const result = await inventory.runInventory({
    supabase,
    repoRoot,
    outputPath: path.join(repoRoot, "artifacts", "adstudio", "evidence", "legacy-manifest.json"),
    projectRef: "project-ref",
    sourceCommit: "f".repeat(40),
    toolSourceSha256: "a".repeat(64),
    rendererSourceSha256: "c".repeat(64),
    now: () => "2026-07-13T00:00:00.000Z",
    logger: () => {},
    writeManifest: async ({ manifest, outputPath }) => {
      writtenManifest = manifest;
      return { outputPath, byteLength: 1, fileSha256: "b".repeat(64) };
    },
  });

  assert.equal(enumeration, 2);
  assert.equal(result.exitCode, 1);
  assert.equal(writtenManifest.drift.detected, true);
  assert.notEqual(writtenManifest.drift.firstWorkspaceIdSetSha256, writtenManifest.drift.secondWorkspaceIdSetSha256);
  assert.equal(
    supabase.calls.filter((call) => call.table === "adstudio_creatives").length,
    3,
    "pass one scans one workspace and pass two scans both",
  );
});

test("inventory runner performs two read-only passes, writes evidence, and never logs raw row IDs", async () => {
  assert.equal(typeof inventory.runInventory, "function");
  const graph = workspaceGraphFixture();
  const supabase = createReadOnlySupabaseFixture({
    workspaces: [{ id: "workspace-1" }],
    adstudio_creatives: graph.creatives,
    adstudio_campaigns: [...graph.campaigns.values()],
    adstudio_campaign_variants: [...graph.variants.values()],
    adstudio_brand_kits: [...graph.brandKits.values()],
  });
  const logs = [];
  let writtenManifest;
  const times = ["2026-07-13T00:00:00.000Z", "2026-07-13T00:01:00.000Z"];

  const result = await inventory.runInventory({
    supabase,
    repoRoot,
    outputPath: path.join(repoRoot, "artifacts", "adstudio", "evidence", "legacy-manifest.json"),
    projectRef: "project-ref",
    sourceCommit: "f".repeat(40),
    toolSourceSha256: "a".repeat(64),
    rendererSourceSha256: "c".repeat(64),
    now: () => times.shift(),
    logger: (message) => logs.push(message),
    writeManifest: async ({ manifest, outputPath }) => {
      writtenManifest = manifest;
      return { outputPath, byteLength: 1, fileSha256: "b".repeat(64) };
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(writtenManifest.acceptanceEligible, true);
  assert.equal(
    supabase.calls.filter((call) => call.table === "adstudio_creatives").length,
    4,
    "each pass must read its creative page and then prove an empty page",
  );
  const output = logs.join("\n");
  assert.doesNotMatch(output, /workspace-1|creative-1|creative-2|campaign-1|variant-1/);
  assert.match(output, /workspaces scanned: 1/i);
  assert.match(output, /legacy composites: 1/i);
  assert.match(output, new RegExp(`Logical manifest SHA-256: ${writtenManifest.manifestSha256}`, "i"));
  assert.match(output, new RegExp(`Written file SHA-256: ${"b".repeat(64)}`, "i"));
});
