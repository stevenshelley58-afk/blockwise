import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { inspectVideoBytes, inspectVideoFile, sniffVideoContainer } from "../src/lib/adstudio/video-media-inspect.ts";
import { optimiseVideoSource } from "../src/lib/adstudio/video-optimise-worker.ts";

/**
 * Integration checks against real encoded media.
 *
 * The unit tests use injected probes, which prove the decision logic but not
 * that a genuine H.264 file is actually accepted or that the resize filter
 * chain produces a playable, correctly sized video. These run against files
 * produced by ffmpeg on this host and skip cleanly where ffmpeg is absent.
 */

const FIXTURES = process.env.BLOCKWISE_VIDEO_FIXTURES ?? "/tmp/video-fixtures";
const FFMPEG = process.env.BLOCKWISE_FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.BLOCKWISE_FFPROBE_PATH ?? "ffprobe";

const fixture = (name: string) => join(FIXTURES, name);
const haveFixtures = existsSync(fixture("vertical-1080x1920.mp4"));

function run(binary: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(binary, args, { shell: false });
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", () => resolve({ code: -1, stdout, stderr }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** Geometry of a real file, read back with ffprobe. */
async function probe(file: string) {
  const result = await run(FFPROBE, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height",
    "-show_entries", "format=duration,format_name",
    "-of", "json",
    file,
  ]);
  const parsed = JSON.parse(result.stdout || "{}") as {
    streams?: Array<{ codec_name?: string; width?: number; height?: number }>;
    format?: { duration?: string; format_name?: string };
  };
  return {
    codec: parsed.streams?.[0]?.codec_name,
    width: parsed.streams?.[0]?.width,
    height: parsed.streams?.[0]?.height,
    duration: Number.parseFloat(parsed.format?.duration ?? "0"),
    container: parsed.format?.format_name,
  };
}

test("a real vertical MP4 is accepted and its measured geometry recorded", { skip: !haveFixtures }, async () => {
  const bytes = new Uint8Array(await readFile(fixture("vertical-1080x1920.mp4")));

  // The container is identified from the actual bytes, before any probe.
  assert.equal(sniffVideoContainer(bytes)?.mime, "video/mp4");

  const result = await inspectVideoBytes({ bytes, declaredMime: "video/mp4" });
  assert.equal(result.ok, true, `a real MP4 must be accepted: ${result.reason ?? ""}`);
  assert.equal(result.mime, "video/mp4");
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.equal(result.hasVideoStream, true);
  assert.equal(result.hasAudioStream, true);
  // 24 seconds is inside the 20-30s deliverable, so no trim is implied.
  assert.ok(result.durationSeconds !== undefined && Math.abs(result.durationSeconds - 24) < 0.5);
});

test("a real MOV is identified as QuickTime, not mislabelled as MP4", { skip: !haveFixtures }, async () => {
  const bytes = new Uint8Array(await readFile(fixture("small.mov")));
  const result = await inspectVideoBytes({ bytes, declaredMime: "video/quicktime" });
  assert.equal(result.ok, true, `a real MOV must be accepted: ${result.reason ?? ""}`);
  assert.equal(result.mime, "video/quicktime");
  assert.equal(result.width, 640);
  assert.equal(result.height, 480);
});

test("a declared type that contradicts the real container is still refused", { skip: !haveFixtures }, async () => {
  const bytes = new Uint8Array(await readFile(fixture("vertical-1080x1920.mp4")));
  // Claiming WebM for an ISO base media file must fail before probing.
  const result = await inspectVideoBytes({ bytes, declaredMime: "video/webm" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "type_mismatch");
});

test("non-video bytes wearing a video extension are refused", { skip: !haveFixtures }, async () => {
  // The header of a PNG is not a video container, whatever it is named.
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const result = await inspectVideoBytes({ bytes: png, declaredMime: "video/mp4" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unsupported_type");
});

test("truncated real media is rejected rather than accepted as playable", { skip: !haveFixtures }, async () => {
  const bytes = new Uint8Array(await readFile(fixture("vertical-1080x1920.mp4")));
  // Keep the valid header so sniffing passes, then cut the file short. This is
  // the shape of an interrupted transfer that was wrongly finalised.
  const truncated = bytes.subarray(0, 4096);
  const result = await inspectVideoBytes({ bytes: truncated, declaredMime: "video/mp4" });
  assert.equal(result.ok, false, "a truncated file must not be accepted");
  assert.ok(
    result.reason === "corrupt_media" || result.reason === "no_video_stream",
    `expected a media failure, got ${result.reason}`,
  );
});

test("the on-disk entry point reads a real file in place", { skip: !haveFixtures }, async () => {
  const file = fixture("landscape-1920x1080.mp4");
  const size = (await stat(file)).size;
  const head = new Uint8Array(await readFile(file)).subarray(0, 32);

  const result = await inspectVideoFile({ filePath: file, sizeBytes: size, head, declaredMime: "video/mp4" });
  assert.equal(result.ok, true, `on-disk inspection must accept a real file: ${result.reason ?? ""}`);
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
});

test("the resize filter chain produces a real, playable, correctly sized copy", { skip: !haveFixtures }, async () => {
  const file = fixture("landscape-1920x1080.mp4");
  const size = (await stat(file)).size;

  // A stand-in client that serves the real fixture and captures the upload.
  let uploadedPath = "";
  const supabase = {
    from(table: string) {
      if (table !== "video_assets") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "c0000000-0000-4000-8000-0000000000c1",
                    workspace_id: "aaaaaaaa-0000-4000-8000-00000000000a",
                    project_id: "a0000000-0000-4000-8000-0000000000a1",
                    object_path: "source.mp4",
                    mime_type: "video/mp4",
                    upload_state: "ready",
                    visibility: "customer",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
        insert: async () => ({ error: null }),
      };
    },
    storage: {
      from() {
        return {
          download: async () => ({ data: new Blob([new Uint8Array(await readFile(file))]), error: null }),
          upload: async (path: string, blob: Blob) => {
            uploadedPath = path;
            // Write the real produced bytes so they can be probed afterwards.
            const { writeFile } = await import("node:fs/promises");
            await writeFile("/tmp/video-fixtures/resized-output.mp4", Buffer.from(await blob.arrayBuffer()));
            return { error: null };
          },
          remove: async () => ({ error: null }),
        };
      },
    },
  } as never;

  // Run the module's real filter chain through the actual ffmpeg binary.
  const result = await optimiseVideoSource({
    supabase,
    workspaceId: "aaaaaaaa-0000-4000-8000-00000000000a",
    projectId: "a0000000-0000-4000-8000-0000000000a1",
    assetId: "c0000000-0000-4000-8000-0000000000c1",
    runFfmpeg: async (args) => {
      const outcome = await run(FFMPEG, args);
      assert.equal(outcome.code, 0, `ffmpeg must succeed: ${outcome.stderr.slice(0, 400)}`);
    },
  });

  assert.ok(uploadedPath.startsWith("aaaaaaaa-0000-4000-8000-00000000000a/projects/"), uploadedPath);

  const produced = await probe("/tmp/video-fixtures/resized-output.mp4");
  assert.equal(produced.codec, "h264", "the copy must be a real H.264 stream");
  assert.equal(produced.width, 1920, "a 1920-long-edge source keeps its width");
  assert.equal(produced.height, 1080);
  // The real file must remain playable and cover the original duration.
  assert.ok(produced.duration > 7, `expected ~8s of video, got ${produced.duration}`);
  assert.ok(result.bytes > 0);
});

test("the resize never upscales a source smaller than the cap", { skip: !haveFixtures }, async () => {
  const file = fixture("small.mov");
  const supabase = {
    from() {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "c0000000-0000-4000-8000-0000000000c2",
                    workspace_id: "aaaaaaaa-0000-4000-8000-00000000000a",
                    project_id: "a0000000-0000-4000-8000-0000000000a1",
                    object_path: "small.mov",
                    mime_type: "video/quicktime",
                    upload_state: "ready",
                    visibility: "customer",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
        insert: async () => ({ error: null }),
      };
    },
    storage: {
      from() {
        return {
          download: async () => ({ data: new Blob([new Uint8Array(await readFile(file))]), error: null }),
          upload: async (_path: string, blob: Blob) => {
            const { writeFile } = await import("node:fs/promises");
            await writeFile("/tmp/video-fixtures/resized-small.mp4", Buffer.from(await blob.arrayBuffer()));
            return { error: null };
          },
          remove: async () => ({ error: null }),
        };
      },
    },
  } as never;

  await optimiseVideoSource({
    supabase,
    workspaceId: "aaaaaaaa-0000-4000-8000-00000000000a",
    projectId: "a0000000-0000-4000-8000-0000000000a1",
    assetId: "c0000000-0000-4000-8000-0000000000c2",
    runFfmpeg: async (args) => {
      const outcome = await run(FFMPEG, args);
      assert.equal(outcome.code, 0, `ffmpeg must succeed: ${outcome.stderr.slice(0, 400)}`);
    },
  });

  const produced = await probe("/tmp/video-fixtures/resized-small.mp4");
  assert.equal(produced.width, 640, "a 640px source must not be blown up");
  assert.equal(produced.height, 480);
});
