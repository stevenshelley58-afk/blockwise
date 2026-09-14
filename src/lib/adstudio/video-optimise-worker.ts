import { spawn } from "node:child_process";
import { openAsBlob } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import { VIDEO_BUCKET, previewObjectPath } from "./video-refs.ts";

/**
 * Resize a large source into a playback copy.
 *
 * The original is never modified or replaced. This produces a separate,
 * smaller object and records it as its own asset, so a customer's upload is
 * always retrievable exactly as it arrived.
 *
 * ffmpeg runs on untrusted customer media, so it is invoked without a shell,
 * with a hard timeout, and inside the worker container that already carries
 * memory, process and CPU limits plus a non-executable scratch mount. It is
 * given a local file path, never a URL, so a supplied file cannot make it fetch
 * anything.
 *
 * Every failure path throws, so the queue retries and finally records the error
 * rather than leaving a customer waiting on a copy that will never appear.
 */

const FFMPEG_BINARY = process.env.BLOCKWISE_FFMPEG_PATH ?? "ffmpeg";
const TRANSCODE_TIMEOUT_MS = 10 * 60 * 1000;

/** Longest edge of the playback copy. Vertical 1080x1920 keeps its framing. */
const MAX_LONG_EDGE = 1920;

export type OptimiseResult = {
  assetId: string;
  objectPath: string;
  bytes: number;
};

export class VideoOptimiseError extends Error {}

export async function optimiseVideoSource(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  projectId: string;
  assetId: string;
  createdBy?: string | null;
  /** Test seam: overrides the ffmpeg invocation. */
  runFfmpeg?: (args: string[]) => Promise<void>;
  scratchRoot?: string;
}): Promise<OptimiseResult> {
  const { supabase, workspaceId, projectId, assetId } = input;

  // Ownership is validated through the record, not the identifiers alone.
  const { data: asset, error } = await supabase
    .from("video_assets")
    .select("id, workspace_id, project_id, object_path, mime_type, upload_state, visibility")
    .eq("id", assetId)
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw new VideoOptimiseError(`Asset lookup failed: ${error.message}`);
  if (!asset) throw new VideoOptimiseError("The source asset was not found.");
  if (asset.upload_state !== "ready") {
    throw new VideoOptimiseError(`Refusing to optimise an asset in state ${asset.upload_state}.`);
  }

  const scratch = await mkdtemp(join(input.scratchRoot ?? tmpdir(), "blockwise-video-optimise-"));
  const sourcePath = join(scratch, "source");
  const outputPath = join(scratch, "playback.mp4");

  try {
    const downloaded = await supabase.storage.from(VIDEO_BUCKET).download(asset.object_path);
    if (downloaded.error || !downloaded.data) {
      throw new VideoOptimiseError(`Source download failed: ${downloaded.error?.message ?? "no data"}`);
    }
    const { writeFile } = await import("node:fs/promises");
    await writeFile(sourcePath, Buffer.from(await downloaded.data.arrayBuffer()), { mode: 0o600 });

    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-nostdin",
      "-y",
      "-i", sourcePath,
      // Never upscale: a smaller source keeps its own size.
      "-vf", `scale='min(${MAX_LONG_EDGE},iw)':'min(${MAX_LONG_EDGE},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "24",
      "-pix_fmt", "yuv420p",
      // Copy audio when it exists; drop it rather than fail when it does not.
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outputPath,
    ];

    if (input.runFfmpeg) {
      await input.runFfmpeg(args);
    } else {
      await runFfmpeg(args);
    }

    const produced = await stat(outputPath).catch(() => null);
    if (!produced || produced.size <= 0) {
      throw new VideoOptimiseError("ffmpeg produced no output.");
    }

    // A separate asset with its own version id: the original is untouched and
    // both remain addressable.
    const versionId = crypto.randomUUID();
    const previewId = crypto.randomUUID();
    const objectPath = previewObjectPath({ workspaceId, projectId, assetId: previewId, versionId });

    const blob = await openAsBlob(outputPath);
    const uploaded = await supabase.storage.from(VIDEO_BUCKET).upload(objectPath, blob, {
      contentType: "video/mp4",
      upsert: false,
    });
    if (uploaded.error) {
      throw new VideoOptimiseError(`Playback copy upload failed: ${uploaded.error.message}`);
    }

    const { error: ledgerError } = await supabase.from("video_assets").insert({
      id: previewId,
      workspace_id: workspaceId,
      project_id: projectId,
      version_id: versionId,
      kind: "preview",
      // A playback copy is something the customer may watch.
      visibility: "customer",
      bucket_id: VIDEO_BUCKET,
      object_path: objectPath,
      original_name: "playback.mp4",
      mime_type: "video/mp4",
      bytes: produced.size,
      upload_state: "ready",
      validated_at: new Date().toISOString(),
      created_by: input.createdBy ?? null,
    });

    if (ledgerError) {
      // Do not leave an object with no ledger row behind.
      await supabase.storage.from(VIDEO_BUCKET).remove([objectPath]).catch(() => {});
      throw new VideoOptimiseError(`Playback ledger insert failed: ${ledgerError.message}`);
    }

    return { assetId: previewId, objectPath, bytes: produced.size };
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

/** Bounded, shell-free ffmpeg invocation. */
async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const child = spawn(FFMPEG_BINARY, args, { shell: false, stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString("utf8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        reject(new VideoOptimiseError("ffmpeg timed out."));
      }
    }, TRANSCODE_TIMEOUT_MS);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new VideoOptimiseError(`ffmpeg could not start: ${error.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new VideoOptimiseError(`ffmpeg exited with ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}
