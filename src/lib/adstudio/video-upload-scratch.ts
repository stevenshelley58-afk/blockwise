import { createWriteStream } from "node:fs";
import { mkdir, open, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Scratch storage for an in-flight upload.
 *
 * Chunked bytes land in a per-asset temporary file and are streamed to object
 * storage only after inspection passes. This is bounded memory rather than a
 * bounded file: a 500 MB source is never held in a Node buffer, and the
 * temporary copy is never the durable copy of anything, so losing it is safe.
 */

const SCRATCH_ROOT = process.env.BLOCKWISE_VIDEO_SCRATCH_DIR ?? "/tmp/blockwise-video-uploads";

/** The asset id is a server-generated uuid; refuse anything else outright. */
const ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class VideoScratchError extends Error {}

function partPath(assetId: string): string {
  assertAssetId(assetId);
  return `${SCRATCH_ROOT}/${assetId}.part`;
}

/**
 * Validate the id before any filesystem call. This must throw rather than be
 * absorbed by a "file does not exist yet" catch, otherwise an invalid id would
 * silently look like an upload that has received no bytes.
 */
function assertAssetId(assetId: string): void {
  if (!ASSET_ID_PATTERN.test(assetId)) {
    throw new VideoScratchError("Refusing a scratch path for a non-uuid asset id.");
  }
}

export async function ensureScratchRoot(): Promise<void> {
  await mkdir(SCRATCH_ROOT, { recursive: true });
}

/** Bytes already received, which is also the offset the next chunk must start at. */
export async function receivedBytes(assetId: string): Promise<number> {
  const target = partPath(assetId);
  try {
    const info = await stat(target);
    return info.size;
  } catch {
    return 0;
  }
}

/** The first bytes of the partial file, for container sniffing. */
export async function readHead(assetId: string, length = 32): Promise<Uint8Array> {
  const target = partPath(assetId);
  try {
    const handle = await open(target, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return new Uint8Array(0);
  }
}

/**
 * Append one chunk. `expectedOffset` must equal the current file size, so two
 * concurrent writers cannot interleave and a retried chunk cannot be applied
 * twice. Returns the new total.
 */
export async function appendChunk(input: {
  assetId: string;
  expectedOffset: number;
  body: ReadableStream<Uint8Array> | null;
}): Promise<number> {
  const current = await receivedBytes(input.assetId);
  if (current !== input.expectedOffset) {
    throw new VideoScratchError(`Upload is at offset ${current}, not ${input.expectedOffset}.`);
  }
  if (!input.body) {
    throw new VideoScratchError("A chunk body is required.");
  }

  await ensureScratchRoot();
  const target = partPath(input.assetId);

  // Append mode keeps the existing bytes and adds only the new chunk.
  const sink = createWriteStream(target, { flags: "a" });
  try {
    await pipeline(Readable.fromWeb(input.body as never), sink);
  } catch (error) {
    await rm(target, { force: true }).catch(() => {});
    throw new VideoScratchError(
      error instanceof Error ? `Chunk write failed: ${error.message}` : "Chunk write failed.",
    );
  }

  return await receivedBytes(input.assetId);
}

export async function scratchFileSize(assetId: string): Promise<number> {
  return await receivedBytes(assetId);
}

export function scratchFilePath(assetId: string): string {
  return partPath(assetId);
}

/** Called once the bytes are safely in object storage, and on rejection. */
export async function discardScratch(assetId: string): Promise<void> {
  await rm(partPath(assetId), { force: true }).catch(() => {});
}
