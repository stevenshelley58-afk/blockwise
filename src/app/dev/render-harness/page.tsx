"use client";

// Render-parity harness page (dev only).
//
// Renders every fixture template in the BROWSER with the same renderAdDoc code
// the server uses, then publishes PNG data URLs on window.__RENDER_PARITY__.
// The Playwright parity spec fetches the server-side render from
// /dev/render-harness/render and asserts: pixels outside text boxes are
// byte-identical; text regions match at SSIM ≥ 0.97. That is what makes
// "what the editor previews == the published pixels" a tested fact.

import { useCallback, useEffect, useState } from "react";

import { renderAdDoc } from "@/lib/adstudio/v2/render/render-doc.ts";
import type { AdDocLayoutKey } from "@/lib/adstudio/v2/render/render-doc.ts";
import { loadBrowserFonts } from "@/lib/adstudio/v2/render/fonts.ts";
import type { RenderedAssets } from "@/lib/adstudio/v2/render/types.ts";
import type { AdDocInstance, AdTemplateDocV2 } from "@/lib/adstudio/v2/template-doc.ts";
import { TEMPLATE_FORMAT_DIMENSIONS } from "@/lib/adstudio/v2/template-doc.ts";

type Fixture = { id: string; doc: AdTemplateDocV2; instances: Record<string, AdDocInstance> };

declare global {
  interface Window {
    __RENDER_PARITY__?: Record<string, string>;
    __RENDER_PARITY_STATUS__?: "loading" | "ready" | "error";
    __RENDER_PARITY_ERROR__?: string;
  }
}

function assetSrc(fixturePublicPath: string): string {
  return `/dev/render-harness/asset?path=${encodeURIComponent(fixturePublicPath)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load ${src}`));
    image.src = src;
  });
}

async function renderFixture(
  doc: AdTemplateDocV2,
  instance: AdDocInstance | null,
  layoutKey: AdDocLayoutKey,
): Promise<string> {
  const layout = doc.formats[layoutKey];
  if (!layout) throw new Error(`no ${layoutKey} layout`);
  const dims = TEMPLATE_FORMAT_DIMENSIONS[layout.format];

  await loadBrowserFonts(doc.fonts);

  const plate = await loadImage(assetSrc(layout.plate.src));
  const patches = new Map<string, HTMLImageElement>();
  const slotImages = new Map<string, HTMLImageElement>();
  for (const layer of layout.layers) {
    if (layer.type === "overlay_patch" && !patches.has(layer.id)) {
      patches.set(layer.id, await loadImage(assetSrc(layer.src)));
    }
  }
  const slotKeys = new Set<string>();
  for (const format of [doc.formats.feed, doc.formats.story]) {
    for (const layer of format?.layers ?? []) {
      if (layer.type === "image_slot") slotKeys.add(layer.inputKey);
    }
  }
  for (const key of slotKeys) {
    const src = instance?.values.images[key]?.src ?? "fixture:/slots/photo-landscape.png";
    const path = src.startsWith("fixture:") ? src.slice("fixture:".length) : src;
    slotImages.set(key, await loadImage(assetSrc(path)));
  }

  const assets: RenderedAssets = {
    plate,
    patches: patches as RenderedAssets["patches"],
    slotImages: slotImages as RenderedAssets["slotImages"],
  };

  const canvas = document.createElement("canvas");
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  renderAdDoc(
    ctx as unknown as Parameters<typeof renderAdDoc>[0],
    doc,
    instance,
    assets,
    layoutKey,
  );
  return canvas.toDataURL("image/png");
}

export default function RenderHarnessPage() {
  const [status, setStatus] = useState("loading fixtures…");

  const run = useCallback(async () => {
    try {
      window.__RENDER_PARITY_STATUS__ = "loading";
      const response = await fetch("/dev/render-harness/fixtures");
      if (!response.ok) throw new Error(`fixtures endpoint returned ${response.status}`);
      const { fixtures } = (await response.json()) as { fixtures: Fixture[] };

      const results: Record<string, string> = {};
      for (const fixture of fixtures) {
        const layouts: AdDocLayoutKey[] = fixture.doc.formats.story ? ["feed", "story"] : ["feed"];
        for (const layoutKey of layouts) {
          const instance = fixture.instances[layoutKey] ?? null;
          const dataUrl = await renderFixture(fixture.doc, instance, layoutKey);
          results[`${fixture.id}/${layoutKey}`] = dataUrl;
        }
      }
      window.__RENDER_PARITY__ = results;
      window.__RENDER_PARITY_STATUS__ = "ready";
      setStatus(`ready — ${Object.keys(results).length} renders`);
    } catch (error) {
      window.__RENDER_PARITY_STATUS__ = "error";
      window.__RENDER_PARITY_ERROR__ = (error as Error).message;
      setStatus(`error: ${(error as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <main style={{ padding: 16, fontFamily: "monospace" }}>
      <h1>AdStudio v2 render-parity harness</h1>
      <p>status: {status}</p>
      <p>Renders published on window.__RENDER_PARITY__ for the parity spec.</p>
    </main>
  );
}
