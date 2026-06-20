"use client";

/**
 * On-demand, in-browser background removal for the "cut out a person and
 * overlay them on the listing photo" flow.
 *
 * Uses @imgly/background-removal, which runs an ONNX/WASM model entirely in the
 * browser: no API key, no server, no paid provider, and the image never leaves
 * the device. The library is loaded from a CDN at runtime with a dynamic import
 * that is explicitly ignored by both webpack and turbopack, so the heavy WASM
 * dependency is NEVER part of the build graph — `next build` is unaffected.
 */

// Annotated as `string` (not a string-literal type) so TypeScript does not try
// to resolve it as a module specifier at build time.
const CDN_URL: string = "https://esm.sh/@imgly/background-removal@1.7.0";

type ImglyModule = {
  removeBackground: (input: Blob | string, config?: Record<string, unknown>) => Promise<Blob>;
};

let modulePromise: Promise<ImglyModule> | null = null;

function loadLibrary(): Promise<ImglyModule> {
  if (!modulePromise) {
    modulePromise = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ CDN_URL) as Promise<ImglyModule>;
  }
  return modulePromise;
}

/** Remove the background from an image, returning a transparent PNG Blob. */
export async function removeBackground(input: Blob | string): Promise<Blob> {
  if (typeof window === "undefined") {
    throw new Error("Background removal can only run in the browser.");
  }
  const library = await loadLibrary();
  return library.removeBackground(input, { output: { format: "image/png" } });
}
