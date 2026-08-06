// Font loading for both render backends.
//
// Browser: FontFace/document.fonts (port of loadPatchFonts from
// canvas/text-patch.ts) — the editor must preload exactly the template's
// fonts[] before first paint or the wrong face flashes (the Tier-2 lesson
// from the 2026-07-27 magic-layers editor plan).
//
// Node: @napi-rs/canvas GlobalFonts.registerFromPath over the same woff2
// files, so both sides rasterize identical glyphs from identical bytes.

import type { AdTemplateDocV2 } from "../template-doc.ts";

export type TemplateFontEntry = AdTemplateDocV2["fonts"][number];

/** Register every woff2 under a directory with napi-rs/canvas. Node only. */
export async function registerNodeFonts(fontsDir: string): Promise<number> {
  if (typeof document !== "undefined") {
    throw new Error("registerNodeFonts is server-only");
  }
  // Dynamic imports keep this module importable from the browser bundle —
  // the server-only branch never executes client-side.
  const [{ GlobalFonts }, { readdirSync }, { join }] = await Promise.all([
    import("@napi-rs/canvas"),
    import("node:fs"),
    import("node:path"),
  ]);

  let registered = 0;
  for (const entry of readdirSync(fontsDir)) {
    if (!entry.endsWith(".woff2")) continue;
    GlobalFonts.registerFromPath(join(fontsDir, entry));
    registered += 1;
  }
  return registered;
}

/**
 * Register only the faces one template declares (server). Keeps the global
 * font table small when many templates render in the same process.
 */
export async function registerTemplateFontsNode(fontsDir: string, fonts: TemplateFontEntry[]): Promise<number> {
  if (typeof document !== "undefined") {
    throw new Error("registerTemplateFontsNode is server-only");
  }
  const [{ GlobalFonts }, { existsSync }, { join }] = await Promise.all([
    import("@napi-rs/canvas"),
    import("node:fs"),
    import("node:path"),
  ]);

  let registered = 0;
  for (const font of fonts) {
    // font.file is a rooted public path like "/fonts/adstudio/x-400.woff2".
    const relative = font.file.replace(/^\//, "");
    const absolute = join(fontsDir, "..", "..", relative);
    if (existsSync(absolute)) {
      GlobalFonts.registerFromPath(absolute, font.fontId);
      registered += 1;
    }
  }
  return registered;
}

/**
 * Load a template's fonts in the browser before the first canvas paint.
 * Resolves once every face is usable (document.fonts.check) — callers must
 * await this before rendering or they will draw fallback glyphs.
 */
export async function loadBrowserFonts(fonts: TemplateFontEntry[]): Promise<Set<string>> {
  if (typeof document === "undefined") return new Set();
  const loaded = new Set<string>();
  const unique = new Map<string, TemplateFontEntry>();
  for (const font of fonts) {
    unique.set(`${font.fontId}:${font.weight}:${font.italic}`, font);
  }
  await Promise.all([...unique.values()].map(async (font) => {
    try {
      const face = new FontFace(
        font.fontId,
        `url("${font.file}") format("woff2")`,
        { weight: String(font.weight), style: font.italic ? "italic" : "normal" },
      );
      await face.load();
      document.fonts.add(face);
      const probe = `${font.italic ? "italic " : ""}${font.weight} 16px "${font.fontId}"`;
      await document.fonts.load(probe, "Blockwise");
      if (document.fonts.check(probe, "Blockwise")) loaded.add(font.fontId);
    } catch {
      // A missing face leaves its layers on the fallback family — the
      // fidelity gate catches it at build time, the editor warns at runtime.
    }
  }));
  return loaded;
}
