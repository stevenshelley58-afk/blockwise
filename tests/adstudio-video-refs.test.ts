import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVideoMediaRef,
  isPathInWorkspace,
  parseVideoMediaRef,
  parseVideoObjectPath,
  previewObjectPath,
  productionObjectPath,
  sourceObjectPath,
  thumbnailObjectPath,
  versionObjectPath,
  visibilityForKind,
} from "../src/lib/adstudio/video-refs.ts";

const WS = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTHER_WS = "bbbbbbbb-0000-4000-8000-00000000000b";
const PROJECT = "a0000000-0000-4000-8000-0000000000a1";
const ASSET = "c0000000-0000-4000-8000-0000000000c1";
const VERSION = "d0000000-0000-4000-8000-0000000000d1";
const RUN = "e0000000-0000-4000-8000-0000000000e1";

test("every generated path starts with the workspace id", () => {
  const paths = [
    sourceObjectPath({ workspaceId: WS, projectId: PROJECT, assetId: ASSET, versionId: VERSION, mime: "video/mp4" }),
    previewObjectPath({ workspaceId: WS, projectId: PROJECT, assetId: ASSET, versionId: VERSION }),
    thumbnailObjectPath({ workspaceId: WS, projectId: PROJECT, assetId: ASSET, versionId: VERSION }),
    productionObjectPath({ workspaceId: WS, projectId: PROJECT, runId: RUN, file: "project.json" }),
    versionObjectPath({ workspaceId: WS, projectId: PROJECT, versionId: VERSION, kind: "draft" }),
    versionObjectPath({ workspaceId: WS, projectId: PROJECT, versionId: VERSION, kind: "final" }),
  ];
  for (const path of paths) {
    assert.ok(path.startsWith(`${WS}/`), `${path} must start with the workspace id`);
    assert.ok(isPathInWorkspace(path, WS), `${path} must resolve to its workspace`);
  }
});

test("a path never resolves into a different workspace", () => {
  const path = sourceObjectPath({ workspaceId: WS, projectId: PROJECT, assetId: ASSET, versionId: VERSION, mime: "video/mp4" });
  assert.equal(isPathInWorkspace(path, OTHER_WS), false);
});

test("path generators reject a non-uuid segment instead of emitting it", () => {
  assert.throws(() =>
    sourceObjectPath({ workspaceId: "..", projectId: PROJECT, assetId: ASSET, versionId: VERSION, mime: "video/mp4" }),
  );
  assert.throws(() =>
    sourceObjectPath({ workspaceId: WS, projectId: "../../etc", assetId: ASSET, versionId: VERSION, mime: "video/mp4" }),
  );
});

test("parseVideoObjectPath round-trips each stage", () => {
  const source = sourceObjectPath({ workspaceId: WS, projectId: PROJECT, assetId: ASSET, versionId: VERSION, mime: "video/quicktime" });
  const parsedSource = parseVideoObjectPath(source);
  assert.equal(parsedSource?.stage, "sources");
  assert.equal(parsedSource?.extension, "mov");
  assert.equal(parsedSource?.assetId, ASSET);

  const final = versionObjectPath({ workspaceId: WS, projectId: PROJECT, versionId: VERSION, kind: "final" });
  assert.equal(parseVideoObjectPath(final)?.stage, "finals");

  const production = productionObjectPath({ workspaceId: WS, projectId: PROJECT, runId: RUN, file: "review.json" });
  assert.equal(parseVideoObjectPath(production)?.stage, "production");
});

test("parseVideoObjectPath refuses traversal, absolute paths and junk", () => {
  for (const bad of [
    "",
    "/etc/passwd",
    `${WS}/projects/${PROJECT}/sources/../../${OTHER_WS}/secret.mp4`,
    `${WS}/projects/${PROJECT}/sources/${ASSET}/${VERSION}.mp4/../../x`,
    "not-a-path",
    `${WS}/projects/${PROJECT}/unknown/${ASSET}/${VERSION}.mp4`,
    `${WS}/projects/not-a-uuid/sources/${ASSET}/${VERSION}.mp4`,
    `${WS}/projects/${PROJECT}/sources/${ASSET}/${VERSION}.exe`,
    `${WS}/projects/${PROJECT}/sources/${ASSET}/${VERSION}`,
    `${WS}/projects/${PROJECT}/production/${RUN}/evil.sh`,
  ]) {
    assert.equal(parseVideoObjectPath(bad), null, `must refuse: ${bad}`);
  }
});

test("media references are API routes, never signed urls", () => {
  const objectPath = sourceObjectPath({ workspaceId: WS, projectId: PROJECT, assetId: ASSET, versionId: VERSION, mime: "video/mp4" });
  const ref = buildVideoMediaRef({ workspaceId: WS, assetId: ASSET, objectPath });
  assert.ok(ref.startsWith("/api/adstudio/videos/media?"));
  assert.ok(!ref.includes("token="), "a stored reference must not carry a bearer token");

  const parsed = parseVideoMediaRef(ref, WS);
  assert.equal(parsed?.assetId, ASSET);
  assert.equal(parsed?.path, objectPath);
});

test("a media reference from another workspace is refused", () => {
  const objectPath = sourceObjectPath({ workspaceId: WS, projectId: PROJECT, assetId: ASSET, versionId: VERSION, mime: "video/mp4" });
  const ref = buildVideoMediaRef({ workspaceId: WS, assetId: ASSET, objectPath });
  assert.equal(parseVideoMediaRef(ref, OTHER_WS), null);
});

test("a forged media reference cannot smuggle another workspace path", () => {
  const foreign = `${OTHER_WS}/projects/${PROJECT}/sources/${ASSET}/${VERSION}.mp4`;
  const forged = `/api/adstudio/videos/media?workspaceId=${WS}&assetId=${ASSET}&path=${encodeURIComponent(foreign)}`;
  assert.equal(parseVideoMediaRef(forged, WS), null);
});

test("production material is operator-only", () => {
  assert.equal(visibilityForKind("production_source"), "operator");
  for (const kind of ["source_upload", "source_workspace", "preview", "thumbnail", "draft", "final"] as const) {
    assert.equal(visibilityForKind(kind), "customer");
  }
});
