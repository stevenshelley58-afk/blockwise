import { useEffect, useRef, useState } from "react";
import type { AdDocumentParsed } from "../../../../packages/ad-template-contract/src/schema";
import type { Placement } from "../../../../packages/ad-template-contract/src/types";

export type CanonicalPreviewStatus = "idle" | "pending" | "ready" | "error";

export interface CanonicalPreviewState {
  status: CanonicalPreviewStatus;
  url: string | null;
  documentHash: string | null;
  templateHash: string | null;
  error: string | null;
}

interface PreviewRequest {
  endpoint: string;
  document: AdDocumentParsed;
  placement: Placement;
  onState: (state: CanonicalPreviewState) => void;
  debounceMs?: number;
}

interface UrlApi {
  createObjectURL: (value: Blob) => string;
  revokeObjectURL: (value: string) => void;
}

export function isCanonicalPreviewRequestReady({
  adId,
  workspaceId,
  document,
}: {
  adId: string;
  workspaceId: string;
  document: AdDocumentParsed | null;
}) {
  return Boolean(adId && workspaceId && document);
}

export function createCanonicalPreviewController(
  fetchImpl: typeof fetch = fetch,
  urlApi: UrlApi = URL,
) {
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let currentUrl: string | null = null;
  let disposed = false;

  const revokeCurrent = () => {
    if (!currentUrl) return;
    urlApi.revokeObjectURL(currentUrl);
    currentUrl = null;
  };

  const cancelPending = () => {
    sequence += 1;
    if (timer) clearTimeout(timer);
    timer = null;
    controller?.abort();
    controller = null;
    // The frame on screen is deliberately left alone. Cancelling work must not
    // blank the creative; the current URL is released when a replacement is in
    // place, or on dispose.
  };

  const request = (input: PreviewRequest) => {
    cancelPending();
    if (disposed) return;
    const requestSequence = sequence;
    // Hold the current frame while the next one renders, so a burst of edits
    // never shows an empty creative.
    input.onState({
      status: "pending",
      url: currentUrl,
      documentHash: null,
      templateHash: null,
      error: null,
    });
    const run = async () => {
      controller = new AbortController();
      try {
        const response = await fetchImpl(input.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document: input.document, placement: input.placement }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Canonical preview failed (" + response.status + ")");
        const blob = await response.blob();
        const nextUrl = urlApi.createObjectURL(blob);
        if (disposed || requestSequence !== sequence) {
          urlApi.revokeObjectURL(nextUrl);
          return;
        }
        revokeCurrent();
        currentUrl = nextUrl;
        input.onState({
          status: "ready",
          url: nextUrl,
          documentHash: response.headers.get("x-blockwise-document-hash"),
          templateHash: response.headers.get("x-blockwise-template-hash"),
          error: null,
        });
      } catch (error) {
        if (disposed || requestSequence !== sequence || (error instanceof DOMException && error.name === "AbortError")) return;
        input.onState({
          status: "error",
          url: null,
          documentHash: null,
          templateHash: null,
          error: error instanceof Error ? error.message : "Canonical preview failed.",
        });
      } finally {
        if (requestSequence === sequence) controller = null;
      }
    };
    if ((input.debounceMs ?? 180) <= 0) {
      void run();
    } else {
      timer = setTimeout(() => { timer = null; void run(); }, input.debounceMs ?? 180);
    }
  };

  const dispose = () => {
    disposed = true;
    cancelPending();
    revokeCurrent();
  };

  return { request, cancelPending, dispose };
}

export function useCanonicalPreview({
  adId,
  workspaceId,
  document,
  placement,
  enabled = true,
}: {
  adId: string;
  workspaceId: string;
  document: AdDocumentParsed | null;
  placement: Placement;
  enabled?: boolean;
}) {
  const [state, setState] = useState<CanonicalPreviewState>({
    status: "idle", url: null, documentHash: null, templateHash: null, error: null,
  });
  const controllerRef = useRef<ReturnType<typeof createCanonicalPreviewController> | null>(null);
  useEffect(() => {
    controllerRef.current = createCanonicalPreviewController();
    return () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = controllerRef.current!;
    if (!enabled || !isCanonicalPreviewRequestReady({ adId, workspaceId, document })) {
      // Stop the work but keep the last frame. Blanking here is what turned a
      // paused or not-yet-built document into a visible flash.
      controller.cancelPending();
      return;
    }
    controller.request({
      endpoint: "/api/adstudio/ads/" + encodeURIComponent(adId) + "/preview?workspaceId=" + encodeURIComponent(workspaceId),
      document: document as AdDocumentParsed,
      placement,
      onState: setState,
    });
    return () => controller.cancelPending();
  }, [adId, workspaceId, document, placement, enabled]);


  return state;
}
