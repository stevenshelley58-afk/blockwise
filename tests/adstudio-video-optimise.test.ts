import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { optimiseVideoSource, VideoOptimiseError } = await import("../src/lib/adstudio/video-optimise-worker.ts");

const WS = "aaaaaaaa-0000-4000-8000-00000000000a";
const PROJECT = "a0000000-0000-4000-8000-0000000000a1";
const ASSET = "c0000000-0000-4000-8000-0000000000c1";

type Recorded = { inserts: unknown[]; uploads: string[]; removals: string[] };

/**
 * A minimal stand-in for the service client, covering only the calls this
 * module makes. It records what happened so the test can assert on behaviour
 * rather than on the query text.
 */
function fakeSupabase(options: {
  asset?: Record<string, unknown> | null;
  lookupError?: { message: string } | null;
  ledgerError?: { message: string } | null;
  uploadError?: { message: string } | null;
}) {
  const recorded: Recorded = { inserts: [], uploads: [], removals: [] };

  const client = {
    from(table: string) {
      if (table === "video_assets") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: options.asset === undefined ? { id: ASSET, upload_state: "ready", object_path: `${WS}/p`, mime_type: "video/mp4" } : options.asset,
                    error: options.lookupError ?? null,
                  }),
                }),
              }),
            }),
          }),
          insert: async (row: unknown) => {
            recorded.inserts.push(row);
            return { error: options.ledgerError ?? null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    storage: {
      from() {
        return {
          download: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }),
          upload: async (path: string) => {
            recorded.uploads.push(path);
            return { error: options.uploadError ?? null };
          },
          remove: async (paths: string[]) => {
            recorded.removals.push(...paths);
            return { error: null };
          },
        };
      },
    },
  };

  return { client: client as never, recorded };
}

async function scratch(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "blockwise-optimise-test-"));
}

test("a ready source produces a separate preview and leaves the original alone", async () => {
  const { client, recorded } = fakeSupabase({});
  const root = await scratch();
  let ffmpegArgs: string[] = [];

  const result = await optimiseVideoSource({
    supabase: client,
    workspaceId: WS,
    projectId: PROJECT,
    assetId: ASSET,
    scratchRoot: root,
    // Stand in for ffmpeg by writing the output file it would have written.
    runFfmpeg: async (args) => {
      ffmpegArgs = args;
      await writeFile(args[args.length - 1], new Uint8Array(2048));
    },
  });

  assert.equal(recorded.uploads.length, 1, "exactly one playback copy is uploaded");
  assert.equal(recorded.inserts.length, 1, "exactly one ledger row is written");

  const row = recorded.inserts[0] as Record<string, unknown>;
  assert.equal(row.kind, "preview");
  assert.equal(row.visibility, "customer");
  assert.equal(row.workspace_id, WS);
  assert.equal(row.project_id, PROJECT);
  assert.equal(row.upload_state, "ready");
  assert.ok(result.objectPath.startsWith(`${WS}/projects/${PROJECT}/previews/`));
  assert.notEqual(result.objectPath, `${WS}/p`);

  // The original must never be an output target.
  assert.ok(!ffmpegArgs.includes(`${WS}/p`), "the original object must not be rewritten");
  await rm(root, { recursive: true, force: true });
});

test("the copy never upscales a smaller source", async () => {
  const { client } = fakeSupabase({});
  const root = await scratch();
  let filter = "";
  await optimiseVideoSource({
    supabase: client,
    workspaceId: WS,
    projectId: PROJECT,
    assetId: ASSET,
    scratchRoot: root,
    runFfmpeg: async (args) => {
      filter = args[args.indexOf("-vf") + 1] ?? "";
      await writeFile(args[args.length - 1], new Uint8Array(64));
    },
  });
  assert.match(filter, /min\(1920,iw\)/, "width must be capped rather than forced");
  assert.match(filter, /force_original_aspect_ratio=decrease/, "aspect ratio must be preserved");
  await rm(root, { recursive: true, force: true });
});

test("an asset that has not passed inspection is refused", async () => {
  const { client } = fakeSupabase({
    asset: { id: ASSET, upload_state: "validating", object_path: "x", mime_type: "video/mp4" },
  });
  await assert.rejects(
    () => optimiseVideoSource({ supabase: client, workspaceId: WS, projectId: PROJECT, assetId: ASSET }),
    VideoOptimiseError,
  );
});

test("an asset from another workspace is refused", async () => {
  const { client } = fakeSupabase({ asset: null });
  await assert.rejects(
    () => optimiseVideoSource({ supabase: client, workspaceId: WS, projectId: PROJECT, assetId: ASSET }),
    VideoOptimiseError,
  );
});

test("ffmpeg writing nothing is a failure, not a silent success", async () => {
  const { client, recorded } = fakeSupabase({});
  const root = await scratch();
  await assert.rejects(
    () =>
      optimiseVideoSource({
        supabase: client,
        workspaceId: WS,
        projectId: PROJECT,
        assetId: ASSET,
        scratchRoot: root,
        runFfmpeg: async () => {
          // Deliberately produce no output file.
        },
      }),
    VideoOptimiseError,
  );
  assert.equal(recorded.inserts.length, 0, "nothing may be recorded when no copy was produced");
  await rm(root, { recursive: true, force: true });
});

test("a ledger failure removes the uploaded copy instead of orphaning it", async () => {
  const { client, recorded } = fakeSupabase({ ledgerError: { message: "insert failed" } });
  const root = await scratch();
  await assert.rejects(
    () =>
      optimiseVideoSource({
        supabase: client,
        workspaceId: WS,
        projectId: PROJECT,
        assetId: ASSET,
        scratchRoot: root,
        runFfmpeg: async (args) => {
          await writeFile(args[args.length - 1], new Uint8Array(32));
        },
      }),
    VideoOptimiseError,
  );
  assert.equal(recorded.uploads.length, 1);
  assert.equal(recorded.removals.length, 1, "the orphaned object must be removed");
  assert.equal(recorded.removals[0], recorded.uploads[0], "the removed object is the one just uploaded");
  await rm(root, { recursive: true, force: true });
});
