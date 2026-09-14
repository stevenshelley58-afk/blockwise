import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VIDEO_ABSOLUTE_MAX_BYTES,
  VIDEO_ALLOWED_IMAGE_MIME,
  VIDEO_ALLOWED_SOURCE_MIME,
  VIDEO_IMAGE_MAX_BYTES,
  VIDEO_MAX_SOURCE_BYTES,
  VIDEO_DELIVERABLE,
  type UploadRejectionReason,
} from "./video-limits.ts";
import type { MediaInspection } from "./video-types.ts";

/**
 * Media inspection for Ad Studio Video.
 *
 * Uploaded bytes are untrusted input. ffprobe only ever reads a file it is
 * given; it is invoked with no shell, a hard timeout, a bounded output buffer
 * and a memory ceiling, and it never receives a URL, so a supplied file cannot
 * make the process fetch anything. Nothing here executes an uploaded file.
 *
 * ffprobe must exist in the image that runs this. It is absent from the current
 * worker image, so `available()` reports false and every caller fails closed
 * rather than accepting unverified media.
 */

export const FFPROBE_BINARY = process.env.BLOCKWISE_FFPROBE_PATH ?? "ffprobe";

const INSPECT_TIMEOUT_MS = 20_000;
const MAX_PROBE_OUTPUT_BYTES = 256 * 1024;
/** ffprobe is a parser: refuse to let it allocate without limit. */
const MAX_PROBE_ADDRESS_SPACE_BYTES = 1_536 * 1024 * 1024;

export type ContainerSignature = {
  mime: (typeof VIDEO_ALLOWED_SOURCE_MIME)[number];
};

/**
 * Sniff the actual container from magic bytes. A declared MIME type is a claim,
 * never evidence, so a mismatch is rejected.
 */
export function sniffVideoContainer(bytes: Uint8Array): ContainerSignature | null {
  if (bytes.length < 12) return null;

  // ISO base media (MP4 / MOV): a `ftyp` box at offset 4.
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand.startsWith("qt")) return { mime: "video/quicktime" };
    return { mime: "video/mp4" };
  }

  // Matroska / WebM: EBML header 1A 45 DF A3.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { mime: "video/webm" };
  }

  return null;
}

export function sniffImageMime(bytes: Uint8Array): (typeof VIDEO_ALLOWED_IMAGE_MIME)[number] | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

type ProbeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
};

type ProbeResult = {
  streams?: ProbeStream[];
  format?: { duration?: string; format_name?: string };
};

export type FfprobeRunner = (
  filePath: string,
) => Promise<{ ok: boolean; stdout: string; timedOut?: boolean }>;

const defaultRunner: FfprobeRunner = async (filePath) => {
  return await new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    let timedOut = false;

    const child = spawn(
      FFPROBE_BINARY,
      [
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        // Never follow an external reference embedded in the file.
        "-nodata",
        filePath,
      ],
      {
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, INSPECT_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length >= MAX_PROBE_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        return;
      }
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_PROBE_OUTPUT_BYTES) {
        stdout = stdout.slice(0, MAX_PROBE_OUTPUT_BYTES);
        child.kill("SIGKILL");
      }
    });

    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout: "" });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, stdout, timedOut });
    });
  });
};

let cachedAvailability: boolean | null = null;

/**
 * Availability is decided by running `ffprobe -version`. A missing binary makes
 * spawn emit an error, which resolves to `{ ok: false }`, so the answer is
 * unambiguous. Callers must fail closed when this returns false.
 */
export async function ffprobeAvailable(): Promise<boolean> {
  if (cachedAvailability !== null) return cachedAvailability;
  cachedAvailability = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(FFPROBE_BINARY, ["-version"], { shell: false, stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, 5_000);
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
  return cachedAvailability;
}

/** Test seam: lets a test inject a fake probe without ffprobe installed. */
export function resetFfprobeAvailabilityCache(): void {
  cachedAvailability = null;
}

/**
 * Inspect a file already on disk. This is the entry point for real uploads:
 * a 500 MB source is probed in place rather than buffered into memory, and the
 * caller is responsible for deleting the scratch file afterwards.
 *
 * `head` is the first bytes of the same file, used for container sniffing so
 * the whole file is never read just to identify it.
 */
export async function inspectVideoFile(input: {
  filePath: string;
  sizeBytes: number;
  head: Uint8Array;
  declaredMime?: string | null;
  runner?: FfprobeRunner;
}): Promise<MediaInspection> {
  if (input.sizeBytes <= 0) return { ok: false, reason: "corrupt_media" };
  if (input.sizeBytes > VIDEO_ABSOLUTE_MAX_BYTES) return { ok: false, reason: "too_large" };

  const container = sniffVideoContainer(input.head);
  if (!container) return { ok: false, reason: "unsupported_type" };

  if (
    input.declaredMime &&
    VIDEO_ALLOWED_SOURCE_MIME.includes(input.declaredMime as never) &&
    input.declaredMime !== container.mime
  ) {
    return { ok: false, reason: "type_mismatch" };
  }

  const runner = input.runner ?? defaultRunner;
  const probeOutput = await runner(input.filePath);
  if (!probeOutput.ok) {
    return { ok: false, reason: "corrupt_media" };
  }

  return interpretProbe(probeOutput.stdout, container.mime, input.sizeBytes);
}

export async function inspectVideoBytes(input: {
  bytes: Uint8Array;
  declaredMime?: string | null;
  runner?: FfprobeRunner;
  /** Injected for tests; avoids writing to disk. */
  probe?: (bytes: Uint8Array) => Promise<{ ok: boolean; stdout: string; timedOut?: boolean }>;
}): Promise<MediaInspection> {
  const bytes = input.bytes;

  if (bytes.length === 0) return { ok: false, reason: "corrupt_media" };
  if (bytes.length > VIDEO_ABSOLUTE_MAX_BYTES) return { ok: false, reason: "too_large" };

  const container = sniffVideoContainer(bytes);
  if (!container) return { ok: false, reason: "unsupported_type" };

  // A declared type that contradicts the actual container is a spoof attempt.
  if (
    input.declaredMime &&
    VIDEO_ALLOWED_SOURCE_MIME.includes(input.declaredMime as never) &&
    input.declaredMime !== container.mime
  ) {
    return { ok: false, reason: "type_mismatch" };
  }

  const runner = input.runner ?? defaultRunner;
  let probeOutput: { ok: boolean; stdout: string; timedOut?: boolean };

  if (input.probe) {
    probeOutput = await input.probe(bytes);
  } else {
    let scratch: string | null = null;
    try {
      // Isolated per-run scratch. The container mounts a writable volume for
      // this; the durable copy is uploaded separately and never lives here.
      scratch = await mkdtemp(join(tmpdir(), "blockwise-video-probe-"));
      const filePath = join(scratch, `probe.${container.mime === "video/webm" ? "webm" : container.mime === "video/quicktime" ? "mov" : "mp4"}`);
      await writeFile(filePath, bytes, { mode: 0o600 });
      probeOutput = await runner(filePath);
    } catch {
      return { ok: false, reason: "corrupt_media" };
    } finally {
      if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
  }

  if (!probeOutput.ok) {
    // A probe that failed or was killed has not proved the media is usable.
    return { ok: false, reason: "corrupt_media" };
  }

  return interpretProbe(probeOutput.stdout, container.mime, bytes.length);
}

/**
 * Turn raw ffprobe JSON into an inspection verdict. Shared by the in-memory and
 * on-disk entry points so both apply exactly the same acceptance rules.
 */
function interpretProbe(
  stdout: string,
  containerMime: (typeof VIDEO_ALLOWED_SOURCE_MIME)[number],
  sizeBytes: number,
): MediaInspection {
  let parsed: ProbeResult;
  try {
    parsed = JSON.parse(stdout) as ProbeResult;
  } catch {
    return { ok: false, reason: "corrupt_media" };
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video) return { ok: false, reason: "no_video_stream" };

  const width = typeof video.width === "number" && video.width > 0 ? video.width : undefined;
  const height = typeof video.height === "number" && video.height > 0 ? video.height : undefined;
  const durationRaw = video.duration ?? parsed.format?.duration;
  const duration = durationRaw === undefined ? undefined : Number.parseFloat(durationRaw);
  if (durationRaw !== undefined && !Number.isFinite(duration)) {
    return { ok: false, reason: "corrupt_media" };
  }

  // A zero-length or unreadable duration is not a usable source clip.
  if (duration !== undefined && duration <= 0) return { ok: false, reason: "corrupt_media" };

  // A clip longer than the deliverable is accepted and flagged for the editor
  // rather than rejected, because an edit is cut from it. Only a missing video
  // track is fatal.
  return {
    ok: true,
    mime: containerMime,
    bytes: sizeBytes,
    width,
    height,
    durationSeconds: duration,
    hasVideoStream: true,
    hasAudioStream: streams.some((stream) => stream.codec_type === "audio"),
    needsOptimisation: sizeBytes > VIDEO_MAX_SOURCE_BYTES,
  };
}

export async function inspectImageBytes(input: {
  bytes: Uint8Array;
  declaredMime?: string | null;
}): Promise<MediaInspection> {
  const bytes = input.bytes;
  if (bytes.length === 0) return { ok: false, reason: "corrupt_media" };
  if (bytes.length > VIDEO_IMAGE_MAX_BYTES) return { ok: false, reason: "too_large" };
  const mime = sniffImageMime(bytes);
  if (!mime) return { ok: false, reason: "unsupported_type" };
  if (
    input.declaredMime &&
    VIDEO_ALLOWED_IMAGE_MIME.includes(input.declaredMime as never) &&
    input.declaredMime !== mime
  ) {
    return { ok: false, reason: "type_mismatch" };
  }
  return { ok: true, mime, bytes: bytes.length };
}

/**
 * A resized derivative is produced from the original; the original is retained
 * unchanged. The customer is told the optimisation happened.
 */
export function deliveryTargetSummary(): string {
  return `${VIDEO_DELIVERABLE.width}x${VIDEO_DELIVERABLE.height} ${VIDEO_DELIVERABLE.minDurationSeconds}-${VIDEO_DELIVERABLE.maxDurationSeconds}s ${VIDEO_DELIVERABLE.container}`;
}

export function isAcceptedSourceMime(value: string): boolean {
  return VIDEO_ALLOWED_SOURCE_MIME.includes(value as never);
}

export type { UploadRejectionReason };
