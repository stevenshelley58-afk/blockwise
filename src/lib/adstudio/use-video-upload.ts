"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Resumable source upload.
 *
 * The file is read one slice at a time and each slice is sent at the offset the
 * server reports. A dropped connection therefore costs one chunk rather than
 * the whole file, and a retried chunk cannot be applied twice because the
 * server refuses an offset that does not match what it already holds.
 *
 * Nothing here trusts the client: the declared type is a hint, and the server
 * inspects the actual bytes before the upload is accepted.
 */

export type UploadPhase =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "uploading"; sentBytes: number; totalBytes: number; attempt: number }
  | { kind: "validating" }
  | { kind: "needs_optimisation"; assetId: string }
  | { kind: "ready"; assetId: string }
  | { kind: "rejected"; message: string }
  | { kind: "error"; message: string };

const MAX_ATTEMPTS_PER_CHUNK = 4;

function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 8_000);
}

export function useVideoUpload(input: { workspaceId: string; projectId: string }) {
  const [phase, setPhase] = useState<UploadPhase>({ kind: "idle" });
  const [fileName, setFileName] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase({ kind: "idle" });
  }, []);

  const upload = useCallback(
    async (file: File) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setFileName(file.name);
      setPhase({ kind: "preparing" });

      try {
        const started = await fetch("/api/adstudio/videos/uploads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            fileName: file.name,
            declaredBytes: file.size,
            // A hint only; the server identifies the container from the bytes.
            declaredMime: file.type || "video/mp4",
          }),
        });

        const startBody = (await started.json().catch(() => ({}))) as {
          uploadId?: string;
          chunkBytes?: number;
          offset?: number;
          error?: string;
        };

        if (!started.ok || !startBody.uploadId) {
          setPhase({ kind: "error", message: startBody.error ?? "That upload could not be started." });
          return;
        }

        const uploadId = startBody.uploadId;
        const chunkBytes = startBody.chunkBytes ?? 8 * 1024 * 1024;
        let offset = startBody.offset ?? 0;

        if (offset > file.size) {
          // The server holds more bytes than this file has, so this is not a
          // resume of the same file. Refuse rather than corrupt the upload.
          setPhase({ kind: "error", message: "That upload does not match the file being sent." });
          return;
        }

        while (offset < file.size) {
          const slice = file.slice(offset, Math.min(offset + chunkBytes, file.size));
          let sent = false;

          for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CHUNK && !sent; attempt += 1) {
            if (attempt > 1) {
              setPhase({ kind: "uploading", sentBytes: offset, totalBytes: file.size, attempt });
              await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
            } else {
              setPhase({ kind: "uploading", sentBytes: offset, totalBytes: file.size, attempt });
            }

            try {
              const response = await fetch(
                `/api/adstudio/videos/uploads/${uploadId}?workspaceId=${encodeURIComponent(input.workspaceId)}&offset=${offset}`,
                {
                  method: "PUT",
                  headers: { "content-type": "application/octet-stream" },
                  signal: controller.signal,
                  body: slice,
                },
              );

              const body = (await response.json().catch(() => ({}))) as { offset?: number; error?: string };

              if (response.ok && typeof body.offset === "number") {
                offset = body.offset;
                sent = true;
                break;
              }

              if (response.status === 409 && typeof body.offset === "number") {
                // The server is telling us where it actually is. Resume there.
                offset = body.offset;
                sent = true;
                break;
              }

              if (response.status === 429) {
                // Rate limited: back off and retry this chunk.
                continue;
              }

              setPhase({ kind: "error", message: body.error ?? "That chunk could not be uploaded." });
              return;
            } catch (error) {
              if (controller.signal.aborted) return;
              if (attempt === MAX_ATTEMPTS_PER_CHUNK) {
                setPhase({
                  kind: "error",
                  message:
                    error instanceof Error
                      ? `Upload stopped: ${error.message}`
                      : "Upload stopped before it finished.",
                });
                return;
              }
            }
          }
        }

        setPhase({ kind: "validating" });

        const finalised = await fetch(
          `/api/adstudio/videos/uploads/${uploadId}?workspaceId=${encodeURIComponent(input.workspaceId)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({ totalBytes: file.size }),
          },
        );

        const finalBody = (await finalised.json().catch(() => ({}))) as {
          state?: string;
          needsOptimisation?: boolean;
          error?: string;
        };

        if (!finalised.ok || finalBody.state !== "ready") {
          setPhase({
            kind: "rejected",
            message: finalBody.error ?? "That file was not accepted.",
          });
          return;
        }

        setPhase(
          finalBody.needsOptimisation
            ? { kind: "needs_optimisation", assetId: uploadId }
            : { kind: "ready", assetId: uploadId },
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setPhase({
          kind: "error",
          message: error instanceof Error ? error.message : "That upload failed.",
        });
      } finally {
        abortRef.current = null;
      }
    },
    [input.projectId, input.workspaceId],
  );

  return { phase, fileName, upload, cancel };
}
